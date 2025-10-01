const express = require('express');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const axios = require('axios');
const archiver = require('archiver');
const https = require('https');

const router = express.Router();

const XML_DIR = path.join(__dirname, '..', 'xml');
const LOG_DIR = path.join(__dirname, '..', 'logs', 'wintour');
const STATUS_FILE = path.join(__dirname, '..', 'logs', 'envios_status.json');

// Garante que as pastas de log existam
fsSync.mkdirSync(LOG_DIR, { recursive: true });

// Agente HTTPS para ignorar erros de certificado (equivalente a CURLOPT_SSL_VERIFYPEER = 0)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// =================================================================
// NOVA FUNÇÃO DE LOG
// =================================================================
/**
 * Salva uma mensagem de log em um arquivo diário.
 * @param {string} message A mensagem para salvar.
 */
async function savelog(message) {
  try {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    const logFileName = `envio_${year}${month}${day}.log`;
    const logFilePath = path.join(LOG_DIR, logFileName);
    
    const timestamp = date.toISOString().replace('T', ' ').substring(0, 19);
    const logMessage = `[${timestamp}] ${message}\n`;

    await fs.appendFile(logFilePath, logMessage);
  } catch (error) {
    console.error('Falha ao escrever no arquivo de log:', error);
  }
}
// =================================================================

// ROTA PARA LISTAR XMLS (sem alterações)
router.get('/list', async (req, res) => {
  try {
    const files = await fs.readdir(XML_DIR);
    const xmlFiles = files.filter(file => path.extname(file).toLowerCase() === '.xml');

    let statusData = {};
    if (fsSync.existsSync(STATUS_FILE)) {
      statusData = JSON.parse(await fs.readFile(STATUS_FILE, 'utf-8'));
    }

    let html = '';
    xmlFiles.forEach(file => {
      const statusInfo = statusData[file];
      const statusHtml = statusInfo 
        ? `<span style="color:${statusInfo.status === 'OK' ? 'green' : 'red'};">${statusInfo.status} (${new Date(statusInfo.data).toLocaleString('pt-BR')})</span>` 
        : 'Pendente';

      html += `
        <tr>
          <td><input type="checkbox" name="xml_files[]" value="${file}"></td>       
          <td><a href="/xml/${file}" target="_blank">${file}</a></td>
          <td>${statusHtml}</td>
        </tr>
      `;
    });
    res.send(html);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.send('<tr><td colspan="3">Nenhum arquivo XML encontrado.</td></tr>');
    } else {
      res.status(500).send(`<tr><td colspan="3" style="color:red;">Erro ao listar arquivos: ${error.message}</td></tr>`);
    }
  }
});

// ROTA PARA ENVIAR XMLS (COM LOGS ADICIONADOS)
router.post('/send', async (req, res) => {
    const { xml_files } = req.body;
    if (!xml_files || !Array.isArray(xml_files) || xml_files.length === 0) {
        return res.status(400).json({ error: 'Nenhum arquivo selecionado.' });
    }

    const results = {};
    let statusData = {};
    if (fsSync.existsSync(STATUS_FILE)) {
        statusData = JSON.parse(await fs.readFile(STATUS_FILE, 'utf-8'));
    }

    const soapTemplate = `<soapenv:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:HubInterfacesIntf-IHubInterfaces"><soapenv:Header/><soapenv:Body><urn:importaArquivo2 soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><aPin xsi:type="xsd:string">yP1V82E2aKf8GNRfx3abgEiCjg==</aPin><aArquivo xsi:type="xsd:string">{XML}</aArquivo><aLivre xsi:type="xsd:string">UNIGLOBEPRO</aLivre></urn:importaArquivo2></soapenv:Body></soapenv:Envelope>`;

    for (const filename of xml_files) {
        try {
            const filePath = path.join(XML_DIR, filename);
            const xmlContent = await fs.readFile(filePath, 'utf-8');
            const base64Content = Buffer.from(xmlContent).toString('base64');
            const envelope = soapTemplate.replace('{XML}', base64Content);
            
            // ADICIONADO: LOGS DO ARQUIVO E DO SOAP ENVIADO
            await savelog(`ARQUIVO: ${filename}`);
            await savelog(`SOAP: ${envelope}`);
            
            const response = await axios.post(
                'https://www.digirotas.com/HubInterfacesSoap/soap/IHubInterfaces',
                envelope,
                {
                    headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                    auth: { username: 'hubstur', password: 'Password@102030' }, // ATENÇÃO: Verifique se a senha está correta
                    httpsAgent
                }
            );

            const responseData = response.data;

            // ADICIONADO: LOG DA RESPOSTA
            await savelog(`RESPOSTA: ${responseData}`);

            const success = responseData && !responseData.includes('#ERRO#');
            results[filename] = {
                success,
                message: success ? '✅ Enviado com sucesso' : `❌ Erro: ${responseData}`
            };
            
            statusData[filename] = {
                data: new Date().toISOString(),
                status: success ? 'OK' : 'ERRO'
            };

        } catch (error) {
            const errorMessage = error.response ? error.response.data : error.message;
            // ADICIONADO: LOG DO ERRO
            await savelog(`ERRO: ${errorMessage}`);
            results[filename] = { success: false, message: `❌ Erro de comunicação: ${errorMessage}` };
            statusData[filename] = { data: new Date().toISOString(), status: 'ERRO' };
        }
    }

    await fs.writeFile(STATUS_FILE, JSON.stringify(statusData, null, 2));
    res.json(results);
});


// ROTA PARA ARQUIVAR E BAIXAR XMLS (sem alterações)
router.post('/archive', async (req, res) => {
    try {
        const files = await fs.readdir(XML_DIR);
        const xmlFiles = files.filter(f => path.extname(f) === '.xml');

        if (xmlFiles.length === 0) {
            return res.json({ sucesso: false, mensagem: 'Nenhum arquivo XML para arquivar.' });
        }

        const date = new Date().toISOString().split('T')[0];
        const subfolderPath = path.join(XML_DIR, date);
        if (!fsSync.existsSync(subfolderPath)) {
            await fs.mkdir(subfolderPath);
        }

        for (const file of xmlFiles) {
            await fs.rename(path.join(XML_DIR, file), path.join(subfolderPath, file));
        }

        const zipFilename = `xmls_${date.replace(/-/g, '')}.zip`;
        const zipFilePath = path.join(subfolderPath, zipFilename);
        const output = fsSync.createWriteStream(zipFilePath);
        const archive = archiver('zip');

        output.on('close', () => {
            res.json({
                sucesso: true,
                mensagem: 'Arquivos arquivados e ZIP gerado.',
                caminho_zip: `/xml/${date}/${zipFilename}`
            });
        });
        
        archive.on('error', (err) => { throw err; });
        archive.pipe(output);
        archive.glob('*.xml', { cwd: subfolderPath });
        await archive.finalize();

    } catch (error) {
        res.status(500).json({ sucesso: false, mensagem: `Erro no servidor: ${error.message}` });
    }
});

module.exports = router;