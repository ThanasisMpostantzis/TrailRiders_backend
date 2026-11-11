'use strict';

/** Parses a JSON list stored as text; always returns an array */
const parseJSONList = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

/** Same list as strings, without duplicates or empty values */
const idList = (value) => [...new Set(parseJSONList(value).map(String).filter((v) => v && v !== 'null'))];

const toNumberOrNull = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const isISODate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const isTime = (v) => /^\d{1,2}:\d{2}$/.test(String(v || ''));

/** Simple length/required validation. rules: { field: { max, required, label } } */
function validateFields(body, rules, partial = false) {
    for (const [field, rule] of Object.entries(rules)) {
        const value = body[field];
        const label = rule.label || field;
        if (rule.required && !partial && (value === undefined || value === null || !String(value).trim())) return `${label} is required`;
        if (value && rule.max && String(value).length > rule.max) return `${label} is too long (max ${rule.max})`;
    }
    return null;
}

const USER_CARD_FIELDS = 'id, username, fullName, image, bike, subscribed';

module.exports = { parseJSONList, idList, toNumberOrNull, todayISO, isISODate, isTime, validateFields, USER_CARD_FIELDS };
