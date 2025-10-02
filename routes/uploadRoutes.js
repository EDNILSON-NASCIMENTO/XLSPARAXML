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
const iconv = require('iconv-lite');

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const XML_DIR = path.join(__dirname, '..', 'xml');
if (!fs.existsSync(XML_DIR)) {
  fs.mkdirSync(XML_DIR, { recursive: true });
}

// =================================================================
// FUNÇÃO AUXILIAR PARA PARSE DE ARQUIVOS (XLSX, XLS, CSV)
// =================================================================
/**
 * Analisa um arquivo (.xlsx, .xls, ou .csv) a partir de um buffer e retorna um array de objetos.
 * @param {object} file O objeto do arquivo vindo do multer (req.file).
 * @returns {Promise<Array<object>>} Uma promise que resolve com os dados da planilha.
 */
function parseUploadedFile(file) {
  return new Promise((resolve, reject) => {
    const extension = path.extname(file.originalname).toLowerCase();
    
    if (extension === '.xlsx' || extension === '.xls') {
      try {
        const workbook = xlsx.read(file.buffer, { type: 'buffer', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
        return resolve(data);
      } catch (error) {
        return reject(new Error(`Erro ao ler o arquivo Excel: ${error.message}`));
      }
    }

    if (extension === '.csv') {
      const results = [];
      const bufferStream = new stream.PassThrough();
      bufferStream.end(file.buffer);

      bufferStream
        .pipe(iconv.decodeStream('iso-8859-1'))
        .pipe(csv({
            mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, ''),
        }))
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', (error) => reject(new Error(`Erro ao ler o arquivo CSV: ${error.message}`)));
      return;
    }

    return reject(new Error('Formato de arquivo não suportado. Use .csv, .xls ou .xlsx.'));
  });
}

/**
 * Formata uma data que pode ser um objeto Date (do XLSX) ou uma string (do CSV).
 * @param {Date|string} dataInput A data a ser formatada.
 * @returns {string} A data formatada como 'dd/MM/yyyy' ou uma string vazia se inválida.
 */
function formatarDataUniversal(dataInput) {
    if (dataInput instanceof Date) {
        return dataInput.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    }
    const dataSQL = formatarDataSQL(dataInput); // Requer que helpers.js trate strings
    if (dataSQL) {
        // new Date() com string 'YYYY-MM-DD' cria data em UTC, evitando problemas de fuso.
        return new Date(dataSQL + 'T00:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    }
    return '';
}

// =================================================================
// ROTAS REATORADAS
// =================================================================

router.post('/:tipo', upload.single('file'), async (req, res) => {
    const { tipo } = req.params;
    if (!['aereo', 'hotel', 'carro', 'onibus'].includes(tipo)) {
        return res.status(404).json({ error: 'Tipo de serviço inválido.' });
    }
    
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    const arquivosGerados = [];
    const erros = [];
    let linhaNum = 1;

    try {
        const data = await parseUploadedFile(req.file);

        for (const registro of data) {
            linhaNum++;
            const handleId = String(registro['Handle'] || '').toLowerCase().trim();
            if (!handleId) continue;

            try {
                // --- Lógica comum a todos ---
                const emissaoTexto = formatarDataUniversal(registro['DataEmissão']);
                if (!emissaoTexto && tipo !== 'aereo') { // Aéreo tem validação própria
                    throw new Error("Data de Emissão está vazia ou em formato inválido.");
                }

                const requisicao = String(registro['RequisiçãoBenner'] || '');
                const formaPgtoRaw = String(registro['FormaPagamento'] || '').toLowerCase();
                const formaPgtoCod = { "cartao": "cc", "faturado": "iv", "invoice": "iv" }[formaPgtoRaw] || formaPgtoRaw;
                const solicitante = String(registro['Solicitante'] || '');
                const aprovador = String(registro['AprovadorEfetivo'] || '');
                const departamento = String(registro['Departamento'] || '');
                const cliente = String(registro['InformaçãoCliente'] || '');
                const centroDescritivo = String(registro['BI'] || '');
                const emissor = String(registro['Emissor'] || '');
                const motivoViagem = String(registro['Finalidade'] || '');
                
                // --- Construção do XML (Base) ---
                const root = create({ version: '1.0', encoding: 'iso-8859-1' }).ele('bilhetes');
                createElementSafe(root, "nr_arquivo", handleId);
                root.ele("data_geracao").txt(new Date().toLocaleDateString('pt-BR'));
                root.ele("hora_geracao").txt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
                createElementSafe(root, "nome_agencia", "uniglobe pro");
                root.ele("versao_xml").txt("4");
        
                const bilhete = root.ele("bilhete");
                createElementSafe(bilhete, "idv_externo", requisicao);
                bilhete.ele("data_lancamento").txt(emissaoTexto);
                createElementSafe(bilhete, "forma_de_pagamento", formaPgtoCod);
                createElementSafe(bilhete, "moeda", "brl");
                createElementSafe(bilhete, "emissor", emissor);
                createElementSafe(bilhete, "cliente", cliente);
                createElementSafe(bilhete, "ccustos_cliente", centroDescritivo);
                createElementSafe(bilhete, "solicitante", solicitante);
                createElementSafe(bilhete, "aprovador", aprovador);
                createElementSafe(bilhete, "departamento", departamento);
                createElementSafe(bilhete, "motivo_viagem", motivoViagem);
                createElementSafe(bilhete, "tipo_domest_inter", "d");

                // --- Lógica específica por tipo ---
                if (tipo === 'aereo') {
                    const dataEmbarqueTexto = formatarDataUniversal(registro['DataEmbarque']);
                    if (!emissaoTexto || !dataEmbarqueTexto) {
                        throw new Error("Data de Emissão ou Embarque está vazia ou em formato inválido.");
                    }
                    
                    const localizador = String(registro['AéreoLocalizador'] || '');
                    const passageiro = String(registro['PassageiroNomeCompleto'] || '');
                    const matricula = String(registro['PassageiroMatrícula'] || '');
                    const cia = String(registro['CiaAérea'] || '').toUpperCase();
                    const prestador = { "LATAM": "la", "AZUL": "ad", "GOL": "g3" }[cia] || cia.toLowerCase();
                    const bilheteNum = String(registro['Bilhete'] || '');
                    const recusa = String(registro['PoliticaMotivoAéreo'] || '');
                    
                    createElementSafe(bilhete, "codigo_produto", "tkt");
                    createElementSafe(bilhete, "fornecedor", prestador);
                    createElementSafe(bilhete, "num_bilhete", bilheteNum);
                    createElementSafe(bilhete, "prestador_svc", prestador);
                    createElementSafe(bilhete, "motivo_recusa", recusa);
                    createElementSafe(bilhete, "matricula", matricula);
                    createElementSafe(bilhete, "numero_requisicao", requisicao);
                    createElementSafe(bilhete, "localizador", localizador);
                    createElementSafe(bilhete, "passageiro", passageiro);
                    createElementSafe(bilhete, "tipo_roteiro", "1");
                    
                    const valores = bilhete.ele("valores");
                    for (const [codigo, valor] of [
                        ["tarifa", limparValorDecimal(registro['TarifaTotalcomTaxas'])], 
                        ["taxa", limparValorDecimal(registro['Taxas'])], 
                        ["taxa_du", limparValorDecimal(registro['DescontoAéreo'])]
                    ]) {
                        const item = valores.ele("item");
                        createElementSafe(item, "codigo", codigo);
                        item.ele("valor").txt(Number(valor).toFixed(2));
                    }

                    const roteiro = bilhete.ele("roteiro");
                    const aereo = roteiro.ele("aereo");
                    for (const t of [{ "origem": String(registro['AeroportoOrigem'] || ''), "destino": String(registro['AeroportoDestino'] || '') }, { "origem": String(registro['AeroportoDestino'] || ''), "destino": String(registro['AeroportoOrigem'] || '') }]) {
                        const trecho = aereo.ele("trecho");
                        createElementSafe(trecho, "cia_iata", prestador);
                        createElementSafe(trecho, "numero_voo", "-");
                        createElementSafe(trecho, "aeroporto_origem", t.origem);
                        createElementSafe(trecho, "aeroporto_destino", t.destino);
                        trecho.ele("data_partida").txt(dataEmbarqueTexto);
                        createElementSafe(trecho, "classe", String(registro['ClasseVoo'] || ''));
                    }
                    createElementSafe(bilhete, "info_adicionais", String(registro['PoliticaJustificativaAéreo'] || ''));
                }
                else if (tipo === 'hotel') {
                    const checkinTexto = formatarDataUniversal(registro['DataCheck-In']);
                    const checkoutTexto = formatarDataUniversal(registro['DataCheck-Out']);
                    if (!checkinTexto || !checkoutTexto) {
                        throw new Error("Datas de Check-In ou Check-Out estão vazias ou em formato inválido.");
                    }
                    
                    const hotel = String(registro['Hotel'] || '');
                    const localizador = String(registro['HotelLocalizador'] || '');
                    const recusa = String(registro['PoliticaMotivoHotel'] || '');
                    const matricula = String(registro['HóspedeMatrícula'] || '');
                    const hospede = String(registro['HóspedeNomeCompleto'] || '');

                    createElementSafe(bilhete, "codigo_produto", "htl");
                    createElementSafe(bilhete, "fornecedor", hotel);
                    createElementSafe(bilhete, "num_bilhete", localizador.toUpperCase());
                    createElementSafe(bilhete, "prestador_svc", hotel);
                    createElementSafe(bilhete, "motivo_recusa", recusa);
                    createElementSafe(bilhete, "matricula", matricula);
                    createElementSafe(bilhete, "numero_requisicao", requisicao);
                    createElementSafe(bilhete, "localizador", localizador);
                    createElementSafe(bilhete, "passageiro", hospede);
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
                    createElementSafe(hotelEl, "categ_apt", "");
                    createElementSafe(hotelEl, "tipo_apt", String(registro['TipoAcomodação'] || ''));
                    hotelEl.ele("dt_check_in").txt(checkinTexto);
                    hotelEl.ele("dt_check_out").txt(checkoutTexto);
                    createElementSafe(hotelEl, "nr_hospedes", "1");
                    createElementSafe(hotelEl, "reg_alimentacao", "");
                    createElementSafe(hotelEl, "cod_tipo_pagto", formaPgtoCod);
                    hotelEl.ele("dt_confirmacao").txt(new Date().toLocaleDateString('pt-BR'));
                    createElementSafe(hotelEl, "confirmado_por", "");

                    createElementSafe(bilhete, "info_adicionais", String(registro['PoliticaJustificativaHotel'] || ''));
                }
                else if (tipo === 'carro') {
                    const retiradaTexto = formatarDataUniversal(registro['DataRetirada']);
                    const devolucaoTexto = formatarDataUniversal(registro['DataDevolução']);
                    if (!retiradaTexto || !devolucaoTexto) {
                        throw new Error("Datas de Retirada ou Devolução estão vazias ou em formato inválido.");
                    }

                    const localRet = String(registro['Locadora'] || '');
                    const localizador = String(registro['VeículoLocalizador'] || '');
                    const recusa = String(registro['PoliticaMotivoVeículo'] || '');
                    const matricula = String(registro['PassageiroVeículoMátricula'] || '');
                    const passageiro = String(registro['PassageiroVeículoNomeCompleto'] || '');

                    createElementSafe(bilhete, "codigo_produto", "car");
                    createElementSafe(bilhete, "fornecedor", localRet);
                    createElementSafe(bilhete, "num_bilhete", localizador.toUpperCase());
                    createElementSafe(bilhete, "prestador_svc", localRet);
                    createElementSafe(bilhete, "motivo_recusa", recusa);
                    createElementSafe(bilhete, "matricula", matricula);
                    createElementSafe(bilhete, "numero_requisicao", requisicao);
                    createElementSafe(bilhete, "localizador", localizador);
                    createElementSafe(bilhete, "passageiro", passageiro);
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
                    createElementSafe(locacao, "local_retirada", localRet);
                    locacao.ele("dt_retirada").txt(retiradaTexto);
                    createElementSafe(locacao, "hr_retirada", "");
                    createElementSafe(locacao, "local_devolucao", String(registro['Locadora'] || ''));
                    locacao.ele("dt_devolucao").txt(devolucaoTexto);
                    createElementSafe(locacao, "hr_devolucao", "");
                    createElementSafe(locacao, "categ_veiculo", "sem informação");
                    createElementSafe(locacao, "cod_tipo_pagto", formaPgtoCod);
                    locacao.ele("dt_confirmacao").txt(new Date().toLocaleDateString('pt-BR'));
                    createElementSafe(locacao, "confirmado_por", "");

                    createElementSafe(bilhete, "info_adicionais", String(registro['PoliticaJustificativaVeículo'] || ''));
                }
                else if (tipo === 'onibus') {
                    const entradaTexto = formatarDataUniversal(registro['DataEntrada']);
                    if (!entradaTexto) {
                        throw new Error("Data de Entrada está vazia ou em formato inválido.");
                    }
                    
                    const fornecedor = String(registro['Fornecedor'] || '');
                    const localizador = String(registro['MiscelaneosLocalizador'] || '');
                    const recusa = String(registro['PoliticaMotivoVeículo'] || ''); // Conferir se é este campo
                    const matricula = String(registro['PassageiroOutrosServiçosMatricula'] || '');
                    const passageiro = String(registro['PassageiroOutrosServiçosNome'] || '');
                    
                    createElementSafe(bilhete, "codigo_produto", "rod");
                    createElementSafe(bilhete, "fornecedor", fornecedor);
                    createElementSafe(bilhete, "num_bilhete", localizador.toUpperCase());
                    createElementSafe(bilhete, "prestador_svc", fornecedor);
                    createElementSafe(bilhete, "motivo_recusa", recusa);
                    createElementSafe(bilhete, "matricula", matricula);
                    createElementSafe(bilhete, "numero_requisicao", requisicao);
                    createElementSafe(bilhete, "localizador", localizador);
                    createElementSafe(bilhete, "passageiro", passageiro);
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
                    const descricao = `${entradaTexto} - ${String(registro['CIDADEORIGEM'] || '').toUpperCase()} - ${String(registro['CIDADEDESTINO'] || '').toUpperCase()}`;
                    createElementSafe(outros, "descricao_outros_svcs", descricao);
                    
                    createElementSafe(bilhete, "info_adicionais", String(registro['PoliticaJustificativaVeículo'] || ''));
                }

                // --- Salvamento do Arquivo (Comum a todos) ---
                const xmlString = root.end({ prettyPrint: true });
                const filename = `wintour-${tipo}-${handleId}.xml`;
                const buffer = iconv.encode(xmlString, 'iso-8859-1');
                fs.writeFileSync(path.join(XML_DIR, filename), buffer);

                arquivosGerados.push(filename);

            } catch (error) {
                erros.push(`Linha ${linhaNum} (Handle: ${handleId}): ${error.message}`);
            }
        }
        res.json({ arquivosGerados, erros });
    } catch (error) {
        res.status(500).json({ error: `Erro fatal ao processar arquivo: ${error.message}` });
    }
});


module.exports = router;