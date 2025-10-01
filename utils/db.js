const mysql = require('mysql2/promise');

// Cria um pool de conexões. O pool gerencia múltiplas conexões
// e as reutiliza, o que é mais eficiente do que criar uma nova conexão
// para cada query.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Testa a conexão ao iniciar
pool.getConnection()
  .then(connection => {
    console.log('Conexão com o banco de dados estabelecida com sucesso.');
    connection.release(); // Libera a conexão de volta para o pool
  })
  .catch(err => {
    console.error('Erro ao conectar com o banco de dados:', err);
  });

module.exports = pool;