'use strict';

const bcrypt = require('bcryptjs');
const { verify } = require('jsonwebtoken');

const { query, queryOne } = require('../config/databaseCon');
const { transporter, forgotPasswordTemplate, createPasswordResetUrl, passwordResetConfirmationTemplate } = require('../utils/mailService');
const { createPasswordResetToken, createAccessToken, createRefreshToken } = require('../utils/tokens.js');
const { notify } = require('../utils/notify');

const isHashed = (pwd) => typeof pwd === 'string' && /^\$2[aby]\$/.test(pwd);

// Older accounts store the password as plain text. They still work and are upgraded to bcrypt on next login.
const checkPassword = async (plain, stored) => {
    if (!stored) return false;
    return isHashed(stored) ? bcrypt.compare(plain, stored) : plain === stored;
};

const hashPassword = (plain) => bcrypt.hash(plain, 10);

const PUBLIC_USER_FIELDS = 'id, username, email, image, fullName, phone, bike, location, bio, tags, instagram, facebook, tiktok, cover, km, rides, subscribed, sub_expire';

const cookieOptions = (maxAge) => ({ httpOnly: true, sameSite: 'lax', maxAge });

function issueTokens(res, user) {
    const payload = { id: user.id, username: user.username };
    const accessToken = createAccessToken(payload);
    const refreshToken = createRefreshToken(payload);

    res.cookie('accToken', accessToken, cookieOptions(60 * 60 * 1000));            // 1 hour
    res.cookie('refToken', refreshToken, cookieOptions(30 * 24 * 60 * 60 * 1000)); // 30 days

    return { accessToken, refreshToken };
}


// LOGIN
const login = async (req, res) => {
    const { username, pwd } = req.body || {};

    if (!username || !pwd) {
        return res.status(400).json({ message: "Username or password are empty", type: "error" });
    }

    try {
        const user = await queryOne('SELECT id, username, password FROM user WHERE username = ?', [username.trim()]);
        if (!user) return res.status(401).json({ message: "User not found", type: "error" });

        const ok = await checkPassword(pwd, user.password);
        if (!ok) return res.status(401).json({ message: "Password is invalid", type: "error" });

        if (!isHashed(user.password)) {
            await query('UPDATE user SET password = ? WHERE id = ?', [await hashPassword(pwd), user.id]);
        }

        const tokens = issueTokens(res, user);
        const profile = await queryOne(`SELECT ${PUBLIC_USER_FIELDS} FROM user WHERE id = ?`, [user.id]);

        return res.status(200).json({
            message: "Login successful",
            type: "success",
            ...tokens,
            user: profile
        });
    } catch (err) {
        console.error('[auth/login]', err);
        return res.status(500).json({ message: "Server error", type: "error" });
    }
};


// SIGNUP
const signup = async (req, res) => {
    const { email, username, pwd, fullName, acceptTerms } = req.body || {};
    const cleanUsername = (username || '').trim();
    const cleanEmail = (email || '').trim();

    if (!cleanUsername || !pwd) {
        return res.status(400).json({ message: "Username or password are empty", type: "error" });
    }
    if (cleanUsername.length < 3 || cleanUsername.length > 12) {
        return res.status(400).json({ message: "Username must be 3-12 characters long", type: "error" });
    }
    if (!/^[A-Za-z0-9_.]+$/.test(cleanUsername)) {
        return res.status(400).json({ message: "Username can contain only letters, numbers, '_' and '.'", type: "error" });
    }
    if (pwd.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters long", type: "error" });
    }
    if (acceptTerms !== true) {
        return res.status(400).json({ message: "Please accept the Terms of Service and Privacy Policy", type: "error" });
    }
    if (cleanEmail && (cleanEmail.length > 30 || !/^\S+@\S+\.\S+$/.test(cleanEmail))) {
        return res.status(400).json({ message: "Please enter a valid e-mail (max 30 characters)", type: "error" });
    }

    try {
        const existing = await queryOne(
            'SELECT username, email FROM user WHERE username = ? OR (email = ? AND ? <> "")',
            [cleanUsername, cleanEmail, cleanEmail]
        );
        if (existing) {
            const field = existing.username === cleanUsername ? 'Username' : 'E-mail';
            return res.status(409).json({ message: `${field} is already in use`, type: "error" });
        }

        const result = await query(
            'INSERT INTO user (username, password, email, fullName, termsAcceptedAt) VALUES (?, ?, ?, ?, NOW())',
            [cleanUsername, await hashPassword(pwd), cleanEmail || null, (fullName || '').trim() || null]
        );

        await notify(result.insertId, {
            subject: 'Welcome to TrailRiders!',
            description: 'Your account is ready. Find a ride to join or create your own and invite other riders.',
        });

        return res.status(201).json({ message: "Signup successful", type: "success" });
    } catch (err) {
        console.error('[auth/signup]', err);
        return res.status(500).json({ message: "Server error", type: "error" });
    }
};


// GOOGLE SIGN-IN
// The app gets a Google ID token (expo-auth-session) and sends it here. We verify it with Google,
// then log in the matching user (by google_id or e-mail) or create a new account.
// Requires GOOGLE_CLIENT_IDS in .env (comma separated web/android/ios client ids).
const googleClientIds = () => (process.env.GOOGLE_CLIENT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

async function uniqueUsername(base) {
    const clean = (base || 'rider').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 9) || 'rider';
    for (let i = 0; i < 20; i++) {
        const candidate = i === 0 ? clean : `${clean}${Math.floor(Math.random() * 900 + 100)}`;
        const taken = await queryOne('SELECT id FROM user WHERE username = ?', [candidate.slice(0, 12)]);
        if (!taken) return candidate.slice(0, 12);
    }
    return `rider${Date.now().toString().slice(-6)}`;
}

const googleLogin = async (req, res) => {
    const { idToken } = req.body || {};
    const allowed = googleClientIds();

    if (!allowed.length) {
        return res.status(501).json({ message: "Google sign-in is not configured on the server yet.", type: "error" });
    }
    if (!idToken) return res.status(400).json({ message: "Missing Google token", type: "error" });

    try {
        const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
        const info = await r.json();
        if (!r.ok || !info.sub) return res.status(401).json({ message: "Invalid Google token", type: "error" });
        if (!allowed.includes(info.aud)) return res.status(401).json({ message: "Google token was issued for another app", type: "error" });
        if (info.email_verified !== 'true' && info.email_verified !== true) {
            return res.status(401).json({ message: "Your Google e-mail is not verified", type: "error" });
        }

        let user = await queryOne('SELECT id, username FROM user WHERE google_id = ?', [info.sub]);
        if (!user && info.email) {
            user = await queryOne('SELECT id, username FROM user WHERE email = ?', [info.email]);
            if (user) await query('UPDATE user SET google_id = ? WHERE id = ?', [info.sub, user.id]);
        }
        if (!user) {
            const username = await uniqueUsername(info.email ? info.email.split('@')[0] : info.given_name);
            const randomPassword = await hashPassword(require('crypto').randomBytes(24).toString('hex'));
            const email = info.email && info.email.length <= 30 ? info.email : null;
            const result = await query(
                'INSERT INTO user (username, password, email, fullName, image, google_id, termsAcceptedAt) VALUES (?, ?, ?, ?, ?, ?, NOW())',
                [username, randomPassword, email, info.name || null, info.picture || null, info.sub]
            );
            user = { id: result.insertId, username };
            await notify(user.id, {
                subject: 'Welcome to TrailRiders!',
                description: `Your account was created with Google. Your username is @${username}.`,
            });
        }

        const tokens = issueTokens(res, user);
        const profile = await queryOne(`SELECT ${PUBLIC_USER_FIELDS} FROM user WHERE id = ?`, [user.id]);
        return res.status(200).json({ message: "Login successful", type: "success", ...tokens, user: profile });
    } catch (err) {
        console.error('[auth/google]', err);
        return res.status(500).json({ message: "Google sign-in failed", type: "error" });
    }
};

const googleConfig = (req, res) => {
    res.json({ enabled: googleClientIds().length > 0 });
};


// REFRESH ACCESS TOKEN (body.refreshToken or refToken cookie)
const refresh = async (req, res) => {
    const token = (req.body && req.body.refreshToken) || (req.cookies && req.cookies.refToken);
    if (!token) return res.status(401).json({ message: "Refresh token missing", type: "error" });

    try {
        const payload = verify(token, process.env.REFRESH_TOKEN_SECRET);
        const user = await queryOne('SELECT id, username FROM user WHERE id = ?', [payload.id]);
        if (!user) return res.status(401).json({ message: "User not found", type: "error" });

        const tokens = issueTokens(res, user);
        return res.status(200).json({ type: "success", ...tokens });
    } catch {
        return res.status(401).json({ message: "Invalid or expired refresh token", type: "error" });
    }
};


// LOGOUT
const logout = (req, res) => {
    res.clearCookie('accToken');
    res.clearCookie('refToken');
    return res.status(200).json({ message: "Logged out", type: "success" });
};


// FORGOT PASSWORD
const forgotpwd = async (req, res) => {
    const email = ((req.body && req.body.email) || '').trim();

    if (!email) {
        return res.status(400).json({ message: "E-mail field is empty", type: "error" });
    }

    try {
        const user = await queryOne('SELECT id, username FROM user WHERE email = ?', [email]);
        if (!user) return res.status(404).json({ message: "E-mail not found", type: "error" });

        const token = createPasswordResetToken({ id: user.id, username: user.username });
        const url = createPasswordResetUrl(token);

        const info = await transporter.sendMail(forgotPasswordTemplate(email, url));
        console.log("Password reset e-mail sent. Transaction ID: %s", info.messageId);

        return res.status(200).json({ message: "Password reset link has been sent", type: "success" });
    } catch (err) {
        console.error('[auth/forgotPassword]', err.message);
        return res.status(500).json({ message: "Could not send the e-mail. Please try again later.", type: "error" });
    }
};


// RESET PASSWORD PAGE (opened from the e-mail link)
const resetPasswordPage = (req, res) => {
    const token = String(req.query.token || '');
    const safeToken = token.replace(/[^A-Za-z0-9._-]/g, '');

    res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reset password · TrailRiders</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F4F6FA;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{background:#fff;padding:32px;border-radius:20px;box-shadow:0 10px 30px rgba(0,51,102,.12);width:100%;max-width:360px}
  h1{margin:0 0 6px;color:#003366;font-size:22px} p{color:#6B7280;margin:0 0 20px;font-size:14px}
  input{width:100%;box-sizing:border-box;padding:13px 14px;margin-bottom:12px;border:1px solid #E5E7EB;border-radius:12px;font-size:15px;background:#F9FAFB}
  button{width:100%;padding:14px;border:0;border-radius:12px;background:#1DA1FA;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
  #msg{margin-top:14px;font-size:14px;text-align:center}
</style></head><body>
<form class="card" id="f">
  <h1>Reset your password</h1><p>Choose a new password for your TrailRiders account.</p>
  <input type="password" name="newPass" placeholder="New password (min 6 characters)" minlength="6" required>
  <input type="password" name="repeatNewPass" placeholder="Repeat new password" minlength="6" required>
  <button type="submit">Save password</button><div id="msg"></div>
</form>
<script>
document.getElementById('f').addEventListener('submit', async function (e) {
  e.preventDefault();
  var fd = new FormData(e.target), msg = document.getElementById('msg');
  var r = await fetch('/auth/resetPassword?token=${safeToken}', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPass: fd.get('newPass'), repeatNewPass: fd.get('repeatNewPass') }) });
  var data = await r.json().catch(function () { return {}; });
  msg.style.color = r.ok ? '#2E9E44' : '#D93025';
  msg.textContent = data.message || (r.ok ? 'Done' : 'Something went wrong');
  if (r.ok) e.target.querySelector('button').disabled = true;
});
</script></body></html>`);
};


// RESET PASSWORD
const resetpwd = async (req, res) => {
    const { newPass, repeatNewPass } = req.body || {};
    const { token } = req.query;

    let payload;
    try {
        payload = verify(token, process.env.FORGOT_PASSWORD_TOKEN_SECRET);
    } catch {
        return res.status(401).json({ message: "Invalid or expired link", type: "error" });
    }

    if (!newPass || newPass.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters long", type: "error" });
    }
    if (newPass !== repeatNewPass) {
        return res.status(400).json({ message: "Passwords do not match", type: "error" });
    }

    try {
        const user = await queryOne('SELECT id, username, email FROM user WHERE id = ?', [payload.id]);
        if (!user) return res.status(404).json({ message: "User not found", type: "error" });

        await query('UPDATE user SET password = ? WHERE id = ?', [await hashPassword(newPass), user.id]);

        transporter.sendMail(passwordResetConfirmationTemplate(user.username, user.email))
            .catch((err) => console.error('[auth/resetPassword] confirmation mail failed:', err.message));

        return res.status(200).json({ message: "Password changed successfully. You can now log in from the app.", type: "success" });
    } catch (err) {
        console.error('[auth/resetPassword]', err);
        return res.status(500).json({ message: "Server error", type: "error" });
    }
};


// DELETE USER (requires login; user must re-type their username)
const deleteUser = async (req, res) => {
    const { confirmUsername } = req.body || {};

    if (!confirmUsername || confirmUsername !== req.user.username) {
        return res.status(400).json({ message: "Wrong username", type: "error" });
    }

    try {
        const userId = req.user.id;

        // Remove the user id from a JSON list column everywhere it appears
        const removeFromList = async (table, column) => {
            const rows = await query(`SELECT id, ${column} AS list FROM ${table} WHERE ${column} LIKE ?`, [`%"${userId}"%`]);
            for (const row of rows) {
                let ids = [];
                try { ids = JSON.parse(row.list) || []; } catch { ids = []; }
                ids = ids.map(String).filter((u) => u !== String(userId));
                await query(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [JSON.stringify(ids), row.id]);
            }
        };

        await removeFromList('rides', 'usersId');
        await removeFromList('passengerride', 'requests');
        await removeFromList('passengerride', 'selectedPassenger');
        await removeFromList('event', 'attendees');

        const ownRides = await query('SELECT id FROM rides WHERE creator_id = ?', [userId]);
        if (ownRides.length) {
            const ids = ownRides.map((r) => r.id);
            await query('DELETE FROM ride_comments WHERE rideId IN (?)', [ids]);
            await query('DELETE FROM ride_ratings WHERE rideId IN (?)', [ids]);
        }
        await query('DELETE FROM rides WHERE creator_id = ?', [userId]);
        await query('DELETE FROM passengerride WHERE creatorId = ?', [userId]);
        await query('DELETE FROM event WHERE ownerId = ?', [userId]);
        await query('DELETE FROM notifications WHERE userId = ?', [userId]);
        await query('DELETE FROM ride_comments WHERE userId = ?', [userId]);
        await query('DELETE FROM ride_ratings WHERE userId = ?', [userId]);
        await query('DELETE FROM messages WHERE senderId = ? OR receiverId = ?', [userId, userId]);
        await query('DELETE FROM follows WHERE followerId = ? OR followingId = ?', [userId, userId]);
        await query('DELETE FROM blocks WHERE blockerId = ? OR blockedId = ?', [userId, userId]);
        await query('DELETE FROM user WHERE id = ?', [userId]);

        res.clearCookie('accToken');
        res.clearCookie('refToken');
        return res.status(200).json({ message: "Account deleted successfully", type: "success" });
    } catch (err) {
        console.error('[auth/deleteUser]', err);
        return res.status(500).json({ message: "Server error", type: "error" });
    }
};


// CHANGE PASSWORD (requires login)
const changePassword = async (req, res) => {
    const { oldPassword, newPassword, confirmNewPassword } = req.body || {};

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ message: "Please fill in all fields", type: "error" });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters long", type: "error" });
    }
    if (confirmNewPassword !== undefined && newPassword !== confirmNewPassword) {
        return res.status(400).json({ message: "Passwords do not match", type: "error" });
    }

    try {
        const user = await queryOne('SELECT id, password FROM user WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ message: "User not found", type: "error" });

        if (!(await checkPassword(oldPassword, user.password))) {
            return res.status(401).json({ message: "Current password is wrong", type: "error" });
        }

        await query('UPDATE user SET password = ? WHERE id = ?', [await hashPassword(newPassword), user.id]);
        return res.status(200).json({ message: "Password updated successfully", type: "success" });
    } catch (err) {
        console.error('[auth/changePassword]', err);
        return res.status(500).json({ message: "Server error", type: "error" });
    }
};

module.exports = {
    login,
    googleLogin,
    googleConfig,
    signup,
    refresh,
    logout,
    forgotpwd,
    resetPasswordPage,
    resetpwd,
    deleteUser,
    changePassword,
    PUBLIC_USER_FIELDS
};
