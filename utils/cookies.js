// OBSOLETE; FOR NOW

const jsc = require('js-cookie');

function addCookie(name, data, exp) {
    return jsc.set(name, data, { expires: exp });
}

function getCookie(name) {
    return jsc.get(name);
}

module.exports = {
    addCookie,
    getCookie
}