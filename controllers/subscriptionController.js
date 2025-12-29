const { runQuery } = require('../config/databaseCon');
const { fetch } = require('../routes/token');

const check = async (req, res) => {
    let user = fetch();
    console.log(user);
    
    let query = `SELECT FROM user WHERE ...`
}