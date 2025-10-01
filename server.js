// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const express = require('express');
const path = require('path');
const uploadRoutes = require('./routes/uploadRoutes');
const xmlRoutes = require('./routes/xmlRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares para parsear JSON e dados de formulário
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos da pasta 'public' (HTML, CSS, JS do cliente)
app.use(express.static(path.join(__dirname, 'public')));

// Servir arquivos das pastas 'xml' e 'logs' para download
app.use('/xml', express.static(path.join(__dirname, 'xml')));
app.use('/logs', express.static(path.join(__dirname, 'logs')));

// Definindo as rotas da API
app.use('/api/upload', uploadRoutes);
app.use('/api/xml', xmlRoutes);

// Rota principal que serve o index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse em http://localhost:${PORT}`);
});