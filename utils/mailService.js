const nodeMailer = require('nodemailer')


// CONFIG
const createPasswordResetUrl = (id, token) => `http://localhost:${process.env.PORT || 8000}/auth/resetPassword/?token=${token}`

const transporter = nodeMailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.MAIL,
        pass: process.env.MAIL_PASSWORD_APP
    },
    tls: {
        rejectUnauthorized: false
    }
});



// ---TEMPLATES--- //
const forgotPasswordTemplate = (email, url) => {
    return {
        from: `"TrailRiders Automated Bot" <${process.env.MAIL}>`,
        to: email,
        subject: "Forgot Password",
        html: `<h2>Password Reset Link</h2>
               <p>Reset your password by clicking on the link below:</p>
               <a href=${url}><button>Reset Password</button></a>
               <br />
               <br />
               <small><a style="color: #38A169" href=${url}>${url}</a></small>
               <br />
               <small>The link will expire in 5 mins!</small>
               <small>If you haven't requested a password reset, cross your fingers.</small>
               <br /><br />
               <p>Thanks,</p>
               <p>TrailRiders Bot (indev)</p>`
    };
};

const passwordResetConfirmationTemplate = (username, email) => {
    return {
        from: `"TrailRiders Automated Bot" <${process.env.MAIL}>`,
        to: email,
        subject: `Your password was reset`,
        html: `<h2>Password Reset Successfully</h2>
               <p>You've successfully updated your password for your account ${username}. </p>
               <small>If you did not change your password, reset it from your account.</small>
               <br /><br />
               <p>Thanks,</p>
               <p>TrailRiders bot (indev)</p>`
    };
};

module.exports = {
    transporter,
    createPasswordResetUrl,
    forgotPasswordTemplate,
    passwordResetConfirmationTemplate
};