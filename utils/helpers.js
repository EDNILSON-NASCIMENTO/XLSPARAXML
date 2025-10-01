const { create } = require('xmlbuilder2');

/**
 * Formata uma data de D/M/YYYY ou M/D/YYYY para YYYY-MM-DD (padrão SQL).
 * @param {string} dataStr - A string da data.
 * @returns {string|null} - A data formatada ou null se inválida.
 */
const formatarDataSQL = (dataStr) => {
  if (!dataStr || typeof dataStr !== 'string') return null;
  const dataLimpa = dataStr.trim();
  if (dataLimpa === '') return null;
  
  // Tenta converter usando o construtor Date, que é flexível.
  const timestamp = new Date(dataLimpa.includes('/') ? dataLimpa.split('/').reverse().join('-') : dataLimpa);
  
  // Valida se a data é válida
  if (isNaN(timestamp.getTime())) {
    // Tenta formato brasileiro DD/MM/YYYY
    const parts = dataLimpa.split('/');
    if (parts.length === 3) {
      const date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
    return null;
  }
  
  return timestamp.toISOString().split('T')[0];
};

/**
 * Limpa e converte um valor monetário (string) para um número (float).
 * Remove 'R$', espaços, pontos e troca vírgula por ponto.
 * @param {string|number} valor - O valor a ser limpo.
 * @returns {number} - O valor como float.
 */
const limparValorDecimal = (valor) => {
  if (typeof valor === 'number') return valor;
  if (!valor || typeof valor !== 'string') return 0;
  
  const limpo = valor.replace(/R\$\s?|\.|'/g, '').replace(',', '.').trim();
  const floatVal = parseFloat(limpo);
  
  return isNaN(floatVal) ? 0 : floatVal;
};

/**
 * Cria um elemento XML com tratamento de caracteres especiais.
 * Converte o valor para ISO-8859-1 antes de criar o elemento.
 * @param {object} parent - O nó pai do xmlbuilder2.
 * @param {string} name - O nome da tag XML.
 * @param {string|null|undefined} value - O valor da tag.
 */
const createElementSafe = (parent, name, value) => {
    const safeValue = value || '';
    // xmlbuilder2 lida com a codificação na serialização, então não precisamos converter manualmente
    parent.ele(name).txt(safeValue);
};

module.exports = {
  formatarDataSQL,
  limparValorDecimal,
  createElementSafe,
};