# Importador de Planilhas para Wintour (Versão Node.js)

Este projeto é uma refatoração da aplicação PHP original para Node.js com Express.js. Ele permite a importação de planilhas nos formatos .XLSX e .CSV, processa os dados, insere em um banco de dados MySQL e gera arquivos XML. Posteriormente, permite o envio desses XMLs para um serviço SOAP externo.

## Funcionalidades

-   **Servidor Web:** Construído com Express.js.
-   **Upload de Arquivos:** Suporte a `.xlsx` (para aéreo) e `.csv` (hotel, carro, ônibus).
-   **Processamento de Dados:** Leitura e parse dos dados das planilhas.
-   **Integração com Banco de Dados:** Insere os dados processados em uma tabela MySQL.
-   **Geração de XML:** Cria um arquivo XML para cada registro válido.
-   **Envio para API SOAP:** Envia os XMLs gerados para um serviço web externo.
-   **Arquivamento:** Compacta os XMLs em um arquivo `.zip` e os move para uma pasta datada.

## Tecnologias Utilizadas

-   **Backend:** Node.js, Express.js
-   **Banco de Dados:** MySQL (com o driver `mysql2`)
-   **Manipulação de Arquivos:**
    -   `multer` para uploads
    -   `xlsx` para planilhas Excel
    -   `csv-parser` para arquivos CSV
    -   `xmlbuilder2` para criar XMLs
    -   `archiver` para criar arquivos ZIP
-   **Requisições HTTP:** `axios` para consumir a API SOAP.
-   **Configuração:** `dotenv` para gerenciar variáveis de ambiente.

## Como Configurar e Rodar

### 1. Pré-requisitos

-   Node.js (versão 16 ou superior)
-   Um servidor de banco de dados MySQL rodando.

### 2. Instalação

1.  Clone ou baixe este repositório para sua máquina local.
2.  Abra um terminal na pasta raiz do projeto.
3.  Execute o seguinte comando para instalar todas as dependências:
    ```bash
    npm install
    ```

### 3. Configuração do Ambiente

1.  Na raiz do projeto, crie um arquivo chamado `.env`.
2.  Copie o conteúdo do exemplo abaixo para o seu arquivo `.env` e substitua os valores pelas suas credenciais de banco de dados.

    ```ini
    # Configuração do Banco de Dados
    DB_HOST=localhost
    DB_USER=root
    DB_PASSWORD=sua_senha_aqui
    DB_NAME=dadoswintour
    DB_PORT=3306

    # Configuração do Servidor
    PORT=3000
    ```

### 4. Executando a Aplicação

1.  No terminal, na raiz do projeto, execute o comando:
    ```bash
    node server.js
    ```
2.  O servidor será iniciado. Você verá uma mensagem no console: `Servidor rodando na porta 3000`.
3.  Abra seu navegador e acesse [http://localhost:3000](http://localhost:3000).

## Estrutura dos Endpoints da API

-   `GET /`: Serve a página principal (`index.html`).
-   `GET /api/xml/list`: Lista os arquivos XML disponíveis.
-   `POST /api/upload/:tipo`: Recebe o upload de uma planilha. `:tipo` pode ser `aereo`, `hotel`, `carro`, ou `onibus`.
-   `POST /api/xml/send`: Envia os arquivos XML selecionados para o serviço externo.
-   `POST /api/xml/archive`: Arquiva os XMLs existentes e fornece um link para download do ZIP.