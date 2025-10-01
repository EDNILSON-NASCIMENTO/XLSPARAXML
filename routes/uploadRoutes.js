const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { create } = require('xmlbuilder2');
const pool = require('../utils/db');
const { formatarDataSQL, limparValorDecimal, createElementSafe } = require('../utils/helpers');
const stream = require('stream');
const iconv = require('iconv-lite'); // Biblioteca para forçar a codificação correta

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const XML_DIR = path.join(__dirname, '..', 'xml');
if (!fs.existsSync(XML_DIR)) {
  fs.mkdirSync(XML_DIR, { recursive: true });
}

// =================================================================
// ROTA PARA AÉREO (.XLSX)
// =================================================================
router.post('/aereo', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  const arquivosGerados = [];
  const erros = [];
  let linhaNum = 1;

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

    for (const registro of data) {
      linhaNum++;
      const handleId = String(registro['Handle'] || '').toLowerCase().trim();
      if (!handleId) continue;

      try {
        const dataEmissao = registro['DataEmissão'];
        const dataEmbarque = registro['DataEmbarque'];

        const dataEmissaoTexto = (dataEmissao instanceof Date) 
            ? dataEmissao.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) 
            : String(dataEmissao || '');
            
        const dataEmbarqueTexto = (dataEmbarque instanceof Date) 
            ? dataEmbarque.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) 
            : String(dataEmbarque || '');

        if (!dataEmissaoTexto || !dataEmbarqueTexto) {
            throw new Error("Data de Emissão ou Embarque está vazia ou em formato inválido.");
        }
        
        const requisicao = String(registro['RequisiçãoBenner'] || '');
        const localizador = String(registro['AéreoLocalizador'] || '');
        const passageiro = String(registro['PassageiroNomeCompleto'] || '');
        const matricula = String(registro['PassageiroMatrícula'] || '');
        const cia = String(registro['CiaAérea'] || '').toUpperCase();
        const classe = String(registro['ClasseVoo'] || '');
        const origem = String(registro['AeroportoOrigem'] || '');
        const destino = String(registro['AeroportoDestino'] || '');
        const forma_pgto = String(registro['FormaPagamento'] || '').toUpperCase();
        const emissor = String(registro['Emissor'] || '');
        const cliente = String(registro['InformaçãoCliente'] || '');
        const centro = String(registro['BI'] || '');
        const solicitante = String(registro['Solicitante'] || '');
        const aprovador = String(registro['AprovadorEfetivo'] || '');
        const departamento = String(registro['Departamento'] || '');
        const motivo = String(registro['Finalidade'] || '');
        const recusa = String(registro['PoliticaMotivoAéreo'] || '');
        const just = String(registro['PoliticaJustificativaAéreo'] || '');
        const bilheteNum = String(registro['Bilhete'] || '');
        const tarifa = limparValorDecimal(registro['TarifaTotalcomTaxas']);
        const taxas = limparValorDecimal(registro['Taxas']);
        const taxa_du = limparValorDecimal(registro['DescontoAéreo']);
        const prestador = { "LATAM": "la", "AZUL": "ad", "GOL": "g3" }[cia] || cia.toLowerCase();
        const forma_pgto_cod = { "CARTAO": "cc", "FATURADO": "iv", "INVOICE": "iv" }[forma_pgto] || forma_pgto.toLowerCase();

        const root = create({ version: '1.0', encoding: 'iso-8859-1' }).ele('bilhetes');
        createElementSafe(root, "nr_arquivo", handleId);
        root.ele("data_geracao").txt(new Date().toLocaleDateString('pt-BR'));
        root.ele("hora_geracao").txt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
        createElementSafe(root, "nome_agencia", "uniglobe pro");
        root.ele("versao_xml").txt("4");
        
        const bilheteEl = root.ele("bilhete");
        createElementSafe(bilheteEl, "idv_externo", requisicao);
        bilheteEl.ele("data_lancamento").txt(dataEmissaoTexto);
        createElementSafe(bilheteEl, "codigo_produto", "tkt");
        createElementSafe(bilheteEl, "fornecedor", prestador);
        createElementSafe(bilheteEl, "num_bilhete", bilheteNum);
        createElementSafe(bilheteEl, "prestador_svc", prestador);
        createElementSafe(bilheteEl, "forma_de_pagamento", forma_pgto_cod);
        createElementSafe(bilheteEl, "moeda", "brl");
        createElementSafe(bilheteEl, "emissor", emissor);
        createElementSafe(bilheteEl, "cliente", cliente);
        createElementSafe(bilheteEl, "ccustos_cliente", centro);
        createElementSafe(bilheteEl, "solicitante", solicitante);
        createElementSafe(bilheteEl, "aprovador", aprovador);
        createElementSafe(bilheteEl, "departamento", departamento);
        createElementSafe(bilheteEl, "motivo_viagem", motivo);
        createElementSafe(bilheteEl, "motivo_recusa", recusa);
        createElementSafe(bilheteEl, "matricula", matricula);
        createElementSafe(bilheteEl, "numero_requisicao", requisicao);
        createElementSafe(bilheteEl, "localizador", localizador);
        createElementSafe(bilheteEl, "passageiro", passageiro);
        createElementSafe(bilheteEl, "tipo_domest_inter", "d");
        createElementSafe(bilheteEl, "tipo_roteiro", "1");
        
        const valores = bilheteEl.ele("valores");
        for (const [codigo, valor] of [["tarifa", tarifa], ["taxa", taxas], ["taxa_du", taxa_du]]) {
            const item = valores.ele("item");
            createElementSafe(item, "codigo", codigo);
            item.ele("valor").txt(Number(valor).toFixed(2));
        }

        const roteiro = bilheteEl.ele("roteiro");
        const aereo = roteiro.ele("aereo");
        for (const t of [{ "origem": origem, "destino": destino }, { "origem": destino, "destino": origem }]) {
            const trecho = aereo.ele("trecho");
            createElementSafe(trecho, "cia_iata", prestador);
            createElementSafe(trecho, "numero_voo", "-");
            createElementSafe(trecho, "aeroporto_origem", t.origem);
            createElementSafe(trecho, "aeroporto_destino", t.destino);
            trecho.ele("data_partida").txt(dataEmbarqueTexto);
            createElementSafe(trecho, "classe", classe);
        }
        
        createElementSafe(bilheteEl, "info_adicionais", just);
        
        const xmlString = root.end({ prettyPrint: true });
        const filename = `wintour-aereo-${handleId}.xml`;

        // CORREÇÃO: Converte a string para um buffer iso-8859-1 com iconv-lite
        const buffer = iconv.encode(xmlString, 'iso-8859-1');
        // E escreve o buffer diretamente, sem especificar codificação para o fs
        fs.writeFileSync(path.join(XML_DIR, filename), buffer);

        arquivosGerados.push(filename);

      } catch (error) {
        erros.push(`Linha ${linhaNum} (Handle: ${handleId}): ${error.message}`);
      }
    }
    res.json({ arquivosGerados, erros });
  } catch (error) {
    res.status(500).json({ error: `Erro fatal ao processar planilha: ${error.message}` });
  }
});

// =================================================================
// ROTA GENÉRICA PARA CSV (HOTEL, CARRO, ONIBUS)
// =================================================================
const processCsv = (tipo) => (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  
  const arquivosGerados = [];
  const erros = [];
  let linhaNum = 1;

  const bufferStream = new stream.PassThrough();
  bufferStream.end(req.file.buffer);

  bufferStream
    .pipe(csv())
    .on('data', async (registro) => {
      bufferStream.pause();
      linhaNum++;
      const handleId = String(registro['Handle'] || '').toLowerCase().trim();
      if (!handleId) {
        bufferStream.resume();
        return;
      }

      try {
        const root = create({ version: '1.0', encoding: 'iso-8859-1' }).ele('bilhetes');
        createElementSafe(root, "nr_arquivo", handleId);
        root.ele("data_geracao").txt(new Date().toLocaleDateString('pt-BR'));
        root.ele("hora_geracao").txt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
        createElementSafe(root, "nome_agencia", "uniglobe pro");
        root.ele("versao_xml").txt("4");
        const bilhete = root.ele("bilhete");

        const formaPgto = String(registro['FormaPagamento'] || '').toLowerCase();
        const formaPgtoCod = { "cartao": "cc", "faturado": "iv", "invoice": "iv" }[formaPgto] || formaPgto;
        
        const dataLancamento = formatarDataSQL(registro['DataEmissão']);
        if (!dataLancamento) throw new Error("Data de Emissão inválida.");

        createElementSafe(bilhete, "idv_externo", String(registro['RequisiçãoBenner'] || ''));
        bilhete.ele("data_lancamento").txt(new Date(dataLancamento).toLocaleDateString('pt-BR', {timeZone: 'UTC'}));
        createElementSafe(bilhete, "forma_de_pagamento", formaPgtoCod);
        createElementSafe(bilhete, "moeda", "brl");
        createElementSafe(bilhete, "emissor", String(registro['Emissor'] || ''));
        createElementSafe(bilhete, "cliente", String(registro['InformaçãoCliente'] || ''));
        createElementSafe(bilhete, "ccustos_cliente", String(registro['BI'] || ''));
        createElementSafe(bilhete, "solicitante", String(registro['Solicitante'] || ''));
        createElementSafe(bilhete, "aprovador", String(registro['AprovadorEfetivo'] || ''));
        createElementSafe(bilhete, "departamento", String(registro['Departamento'] || ''));
        createElementSafe(bilhete, "motivo_viagem", String(registro['Finalidade'] || ''));
        createElementSafe(bilhete, "tipo_domest_inter", "d");
        
        if (tipo === 'hotel') {
            const checkin = formatarDataSQL(registro['DataCheck-In']);
            const checkout = formatarDataSQL(registro['DataCheck-Out']);
            if (!checkin || !checkout) throw new Error("Datas de check-in/out inválidas.");

            createElementSafe(bilhete, "codigo_produto", "htl");
            createElementSafe(bilhete, "fornecedor", String(registro['Hotel'] || ''));
            createElementSafe(bilhete, "num_bilhete", String(registro['HotelLocalizador'] || '').toUpperCase());
            createElementSafe(bilhete, "prestador_svc", String(registro['Hotel'] || ''));
            createElementSafe(bilhete, "motivo_recusa", String(registro['PoliticaMotivoHotel'] || ''));
            createElementSafe(bilhete, "matricula", String(registro['HóspedeMatrícula'] || ''));
            createElementSafe(bilhete, "passageiro", String(registro['HóspedeNomeCompleto'] || ''));
            createElementSafe(bilhete, "tipo_roteiro", "2");

            const valores = bilhete.ele("valores");
            for (const [codigo, valor] of [
                ["tarifa", limparValorDecimal(registro['ValorTotalHotel'])], 
                ["taxa", limparValorDecimal(registro['TotalTaxas'])], 
                ["taxa_du", 0.00]
            ]) {
                const item = valores.ele("item");
                createElementSafe(item, "codigo", codigo);
                item.ele("valor").txt(Number(valor).toFixed(2));
            }

            const roteiro = bilhete.ele("roteiro");
            const hotelEl = roteiro.ele("hotel");
            createElementSafe(hotelEl, "nr_apts", "1");
            createElementSafe(hotelEl, "tipo_apt", String(registro['TipoAcomodação'] || ''));
            hotelEl.ele("dt_check_in").txt(new Date(checkin).toLocaleDateString('pt-BR', {timeZone: 'UTC'}));
            hotelEl.ele("dt_check_out").txt(new Date(checkout).toLocaleDateString('pt-BR', {timeZone: 'UTC'}));
            createElementSafe(hotelEl, "nr_hospedes", "1");
            createElementSafe(hotelEl, "cod_tipo_pagto", formaPgtoCod);
            hotelEl.ele("dt_confirmacao").txt(new Date().toLocaleDateString('pt-BR'));

            createElementSafe(bilhete, "info_adicionais", String(registro['PoliticaJustificativaHotel'] || ''));
        } 
        else if (tipo === 'carro') {
            const checkin = formatarDataSQL(registro['DataRetirada']);
            const checkout = formatarDataSQL(registro['DataDevolução']);
            if (!checkin || !checkout) throw new Error("Datas de retirada/devolução inválidas.");

            createElementSafe(bilhete, "codigo_produto", "car");
            createElementSafe(bilhete, "fornecedor", String(registro['Locadora'] || ''));
            createElementSafe(bilhete, "num_bilhete", String(registro['VeículoLocalizador'] || '').toUpperCase());
            createElementSafe(bilhete, "prestador_svc", String(registro['Locadora'] || ''));
            createElementSafe(bilhete, "motivo_recusa", String(registro['PoliticaMotivoVeículo'] || ''));
            createElementSafe(bilhete, "matricula", String(registro['PassageiroVeículoMátricula'] || ''));
            createElementSafe(bilhete, "passageiro", String(registro['PassageiroVeículoNomeCompleto'] || ''));
            createElementSafe(bilhete, "tipo_roteiro", "3");

            const valores = bilhete.ele("valores");
            for (const [codigo, valor] of [
                ["tarifa", limparValorDecimal(registro['ValorTotal'])], 
                ["taxa", limparValorDecimal(registro['TotalTaxas'])], 
                ["taxa_du", 0.00]
            ]) {
                const item = valores.ele("item");
                createElementSafe(item, "codigo", codigo);
                item.ele("valor").txt(Number(valor).toFixed(2));
            }

            const roteiro = bilhete.ele("roteiro");
            const locacao = roteiro.ele("locacao");
            createElementSafe(locacao, "cidade_retirada", String(registro['CidadeRetirada'] || ''));
            createElementSafe(locacao, "local_retirada", String(registro['Locadora'] || ''));
            locacao.ele("dt_retirada").txt(new Date(checkin).toLocaleDateString('pt-BR', {timeZone: 'UTC'}));
            createElementSafe(locacao, "local_devolucao", String(registro['Locadora'] || ''));
            locacao.ele("dt_devolucao").txt(new Date(checkout).toLocaleDateString('pt-BR', {timeZone: 'UTC'}));
            createElementSafe(locacao, "cod_tipo_pagto", formaPgtoCod);
            locacao.ele("dt_confirmacao").txt(new Date().toLocaleDateString('pt-BR'));

            createElementSafe(bilhete, "info_adicionais", String(registro['PoliticaJustificativaVeículo'] || ''));
        }
        else if (tipo === 'onibus') {
            const checkin = formatarDataSQL(registro['DataEntrada']);
            if (!checkin) throw new Error("Data de Entrada inválida.");
            
            createElementSafe(bilhete, "codigo_produto", "rod");
            createElementSafe(bilhete, "fornecedor", String(registro['Fornecedor'] || ''));
            createElementSafe(bilhete, "num_bilhete", String(registro['MiscelaneosLocalizador'] || '').toUpperCase());
            createElementSafe(bilhete, "prestador_svc", String(registro['Fornecedor'] || ''));
            createElementSafe(bilhete, "motivo_recusa", String(registro['PoliticaMotivoVeículo'] || ''));
            createElementSafe(bilhete, "matricula", String(registro['PassageiroOutrosServiçosMatricula'] || ''));
            createElementSafe(bilhete, "passageiro", String(registro['PassageiroOutrosServiçosNome'] || ''));
            createElementSafe(bilhete, "tipo_roteiro", "7");

            const valores = bilhete.ele("valores");
            for (const [codigo, valor] of [
                ["tarifa", limparValorDecimal(registro['MiscelaneosValorTotal'])], 
                ["taxa", limparValorDecimal(registro['TotalTaxas'])], 
                ["taxa_du", 0.00]
            ]) {
                const item = valores.ele("item");
                createElementSafe(item, "codigo", codigo);
                item.ele("valor").txt(Number(valor).toFixed(2));
            }
            
            const roteiro = bilhete.ele("roteiro");
            const outros = roteiro.ele("outros_servicos");
            const descricao = `${new Date(checkin).toLocaleDateString('pt-BR', {timeZone: 'UTC'})} - ${String(registro['CIDADEORIGEM'] || '').toUpperCase()} - ${String(registro['CIDADEDESTINO'] || '').toUpperCase()}`;
            createElementSafe(outros, "descricao_outros_svcs", descricao);

            createElementSafe(bilhete, "info_adicionais", String(registro['PoliticaJustificativaVeículo'] || ''));
        }
        
        const xmlString = root.end({ prettyPrint: true });
        const filename = `wintour-${tipo}-${handleId}.xml`;

        // CORREÇÃO: Converte e salva como buffer iso-8859-1
        const buffer = iconv.encode(xmlString, 'iso-8859-1');
        fs.writeFileSync(path.join(XML_DIR, filename), buffer);

        arquivosGerados.push(filename);

      } catch (error) {
        erros.push(`Linha ${linhaNum} (Handle: ${handleId}): ${error.message}`);
      } finally {
        bufferStream.resume();
      }
    })
    .on('end', () => res.json({ arquivosGerados, erros }))
    .on('error', (error) => res.status(500).json({ error: `Erro ao ler CSV: ${error.message}` }));
};

router.post('/hotel', upload.single('file'), processCsv('hotel'));
router.post('/carro', upload.single('file'), processCsv('carro'));
router.post('/onibus', upload.single('file'), processCsv('onibus'));

module.exports = router;