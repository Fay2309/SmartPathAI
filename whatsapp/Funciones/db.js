const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'localhost',
    user: 'root',      
    password: 'hola12', 
    database: 'smartai'
};

const pool = mysql.createPool(dbConfig);

module.exports = pool;