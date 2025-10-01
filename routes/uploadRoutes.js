const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { create } = require('xmlbuilder2');
const pool = require('../utils/db');
const { formatarDataSQL, limparValorDecimal, createElementSafe } = require('../utils/helpers');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

const XML_DIR = path.join(__dirname, '..', 'xml');
if (!fs.existsSync(XML_DIR)) {
  fs.mkdirSync(XML_DIR, { recursive: true });
}

// ROTA PARA AÉREO (.XLSX)
router.post('/aereo', upload.single('file'), async (req, res) => {
  const filePath = req.file.path;
  const arquivosGerados = [];
  const erros = [];
  let linhaNum = 1;

  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet, { defval: "" });

    for (const registro of data) {
      linhaNum++;
      const handleId = registro['Handle'] ? String(registro['Handle']).toLowerCase() : 'N/D';

      try {
        const dataEmissaoTexto = String(registro['DataEmissão'] || '');
        const dataEmbarqueTexto = String(registro['DataEmbarque'] || '');

        if (!handleId || !dataEmissaoTexto || !dataEmbarqueTexto) {
          throw new Error("Handle, Data de Emissão ou Embarque está vazio.");
        }

        const requisicao = registro['RequisiçãoBenner'];
        const localizador = registro['AéreoLocalizador'];
        const passageiro = registro['PassageiroNomeCompleto'];
        const matricula = registro['PassageiroMatrícula'];
        const cia = String(registro['CiaAérea']).toUpperCase();
        const origem = registro['AeroportoOrigem'];
        const destino = registro['AeroportoDestino'];
        const forma_pgto = String(registro['FormaPagamento']).toUpperCase();
        const emissor = registro['Emissor'];
        const cliente = registro['InformaçãoCliente'];
        const centro = registro['BI'];
        const solicitante = registro['Solicitante'];
        const aprovador = registro['AprovadorEfetivo'];
        const departamento = registro['Departamento'];
        const motivo = registro['Finalidade'];
        const bilhete = registro['Bilhete'];
        const tarifa = limparValorDecimal(registro['TarifaTotalcomTaxas']);
        const taxas = limparValorDecimal(registro['Taxas']);
        const taxa_du = limparValorDecimal(registro['DescontoAéreo']);
        const prestador = { "LATAM": "la", "AZUL": "ad", "GOL": "g3" }[cia] || cia.toLowerCase();
        const forma_pgto_cod = { "CARTAO": "cc", "FATURADO": "iv", "INVOICE": "iv" }[forma_pgto] || forma_pgto.toLowerCase();

        const conn = await pool.getConnection();
        await conn.execute(
          `INSERT INTO servicos_wintour (tipo_servico, requisicao, handle, localizador, nome_passageiro, matricula, cia_aerea, origem, destino, forma_pagamento, emissor, cliente, tarifa, taxas, desconto, solicitante, aprovador, departamento) 
           VALUES ('aereo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [requisicao, handleId, localizador, passageiro, matricula, cia, origem, destino, forma_pgto_cod, emissor, cliente, tarifa, taxas, taxa_du, solicitante, aprovador, departamento]
        );
        conn.release();

        const root = create({ version: '1.0', encoding: 'iso-8859-1' }).ele('bilhetes');
        root.ele('nr_arquivo').txt(handleId);
        root.ele('data_geracao').txt(new Date().toLocaleDateString('pt-BR'));
        root.ele('hora_geracao').txt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
        createElementSafe(root, 'nome_agencia', 'uniglobe pro');
        root.ele('versao_xml').txt('4');
        const bilheteEl = root.ele('bilhete');
        createElementSafe(bilheteEl, 'idv_externo', requisicao);
        bilheteEl.ele('data_lancamento').txt(dataEmissaoTexto);
        bilheteEl.ele('codigo_produto').txt('tkt');
        createElementSafe(bilheteEl, 'fornecedor', prestador);
        createElementSafe(bilheteEl, 'num_bilhete', bilhete);
        
        // ... (resto da criação do XML para aéreo)
        
        const xmlString = root.end({ prettyPrint: true });
        const filename = `wintour-${handleId}.xml`;
        fs.writeFileSync(path.join(XML_DIR, filename), xmlString, 'iso-8859-1');
        arquivosGerados.push(filename);

      } catch (error) {
        erros.push(`Linha ${linhaNum} (Handle: ${handleId}): ${error.message}`);
      }
    }
    res.json({ arquivosGerados, erros });
  } catch (error) {
    res.status(500).json({ error: `Erro fatal ao processar planilha: ${error.message}` });
  } finally {
    fs.unlinkSync(filePath); // Limpa o arquivo temporário
  }
});


// ROTA PARA HOTEL, CARRO, ONIBUS (CSV)
['hotel', 'carro', 'onibus'].forEach(tipo => {
  router.post(`/${tipo}`, upload.single('file'), async (req, res) => {
    const filePath = req.file.path;
    const arquivosGerados = [];
    const erros = [];
    let linhaNum = 1;

    const stream = fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', async (registro) => {
        stream.pause(); // Pausa o stream para processar a linha de forma assíncrona
        linhaNum++;
        const handleId = registro['Handle'] ? String(registro['Handle']).toLowerCase() : 'N/D';
        
        try {
            const conn = await pool.getConnection();

            if (tipo === 'hotel') {
                const checkin = formatarDataSQL(registro['DataCheck-In']);
                const checkout = formatarDataSQL(registro['DataCheck-Out']);
                if (!checkin || !checkout) throw new Error("Datas inválidas.");
                // ... Lógica de inserção e XML para hotel ...
            } else if (tipo === 'carro') {
                // ... Lógica de inserção e XML para carro ...
            } else if (tipo === 'onibus') {
                // ... Lógica de inserção e XML para ônibus ...
            }
            
            // Exemplo de geração de XML (simplificado)
            const root = create({ version: '1.0', encoding: 'iso-8859-1' }).ele('bilhetes');
            root.ele('nr_arquivo').txt(handleId);
            // ... (resto da criação do XML específico para o tipo)
            
            const xmlString = root.end({ prettyPrint: true });
            const filename = `wintour-${handleId}.xml`;
            fs.writeFileSync(path.join(XML_DIR, filename), xmlString, 'iso-8859-1');
            arquivosGerados.push(filename);
            
            conn.release();

        } catch (error) {
          erros.push(`Linha ${linhaNum} (Handle: ${handleId}): ${error.message}`);
        } finally {
          stream.resume(); // Continua o stream para a próxima linha
        }
      })
      .on('end', () => {
        fs.unlinkSync(filePath); // Limpa o arquivo temporário
        res.json({ arquivosGerados, erros });
      })
      .on('error', (error) => {
        fs.unlinkSync(filePath);
        res.status(500).json({ error: `Erro ao ler arquivo CSV: ${error.message}` });
      });
  });
});

module.exports = router;