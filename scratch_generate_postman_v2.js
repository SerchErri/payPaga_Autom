const fs = require('fs');
const path = require('path');

const collection = {
  info: {
    name: "Dinaria AR Cash-In Scenarios (Auto-Tokens v2)",
    description: "Colección para probar manualmente los flujos borde con pre-request de OAuth2 de auto-renovación y parsing local de referencias.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  variable: [
    { key: "BASE_URL", value: "https://api.v2.dev.paypaga.com", type: "string" },
    { key: "env.BASEURL", value: "https://api.v2.dev.paypaga.com", type: "string" },
    { key: "ClientID", value: "AQUI_TU_CLIENT_ID", type: "string" },
    { key: "ClientSecret", value: "AQUI_TU_CLIENT_SECRET", type: "string" },
    { key: "DINARIA_SANDBOX_URL", value: "https://api.sandbox.dinaria.com/ars/cashin/simulate", type: "string" },
    { key: "DINARIA_SANDBOX_TOKEN", value: "di_sand_reg_paypaga_merch", type: "string" },
    { key: "CorrelationTransactionIdentifier", value: "", type: "string" }
  ],
  item: []
};

const preRequestScript = `
const genRef = () => 'PoH2H-' + Math.random().toString(36).substring(2, 11).toUpperCase();
const correlation = genRef();
pm.collectionVariables.set("CorrelationTransactionIdentifier", correlation);

const baseUrl = pm.environment.get("env.BASEURL") || pm.variables.get("BASE_URL") || pm.variables.get("env.BASEURL");
const authUrl = baseUrl + "/oauth2/token"; 

const currentClientId = pm.environment.get("ClientID") || pm.variables.get("ClientID");
const currentClientSecret = pm.environment.get("ClientSecret") || pm.variables.get("ClientSecret");

const authRequest = {
    url: authUrl,
    method: 'POST',
    header: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'DisablePartnerMock': 'true'
    },
    body: {
        mode: 'urlencoded',
        urlencoded: [
            { key: "grant_type", value: "client_credentials" },
            { key: "client_id", value: currentClientId },
            { key: "client_secret", value: currentClientSecret }
        ]
    }
};

pm.sendRequest(authRequest, (err, res) => {
    if (err) {
        console.error("❌ Error de red Auth:", err);
        return;
    }
    
    if (res.code !== 200 && res.code !== 201) {
        console.error("❌ Error en OAuth2 (Status " + res.code + "):", res.text());
        return;
    }

    const jsonData = res.json();
    const token = jsonData.access_token || jsonData.token; 
    
    if (token) {
        pm.variables.set("AccessToken", token);
        console.log("✅ Token OAuth2 actualizado (local): " + token.substring(0,20) + "...");
    } else {
        console.error("❌ Auth OK pero no se encontró 'access_token' en:", jsonData);
    }
});
`.split('\n');

const postRequestScript = `
const jsonData = pm.response.json();
let cvu = null;
let refValue = null;
let txId = jsonData.transaction_id || jsonData.id;

if (jsonData.instructions) {
    cvu = jsonData.instructions.bank_account;
    refValue = jsonData.instructions.reference;
} else if (jsonData.paymentData) {
    cvu = jsonData.paymentData.cbu;
    refValue = jsonData.paymentData.reference;
} else if (jsonData.payment_methods && jsonData.payment_methods.length > 0) {
    let fields = jsonData.payment_methods[0].fields;
    let refF = fields.find(f => f.name && f.name.toLowerCase().includes('reference'));
    let cvuF = fields.find(f => f.name && f.name.toLowerCase().includes('cvu'));
    if(refF) refValue = refF.value;
    if(cvuF) cvu = cvuF.value;
}

if(!refValue) refValue = txId;

pm.variables.set("EXTRACTED_REF", refValue);
pm.variables.set("EXTRACTED_CVU", cvu);
pm.variables.set("TRANSACTION_ID", txId);

console.log("Tx ID extraído: " + txId);
console.log("Ref local guardada: " + refValue);
console.log("CVU local guardado: " + cvu);
`.split('\n');

const createPayinRequest = (name, amount, allowOverUnder) => ({
  name,
  event: [
    {
      listen: "prerequest",
      script: {
        exec: preRequestScript,
        type: "text/javascript"
      }
    },
    {
      listen: "test",
      script: {
        exec: postRequestScript,
        type: "text/javascript"
      }
    }
  ],
  request: {
    method: "POST",
    header: [
      { key: "DisablePartnerMock", value: "true", type: "text" },
      { key: "Authorization", value: "Bearer {{AccessToken}}", type: "text" },
      { key: "Content-Type", value: "application/json", type: "text" }
    ],
    url: { raw: "{{BASE_URL}}/v2/transactions/pay-in", host: ["{{BASE_URL}}"], path: ["v2", "transactions", "pay-in"] },
    body: {
      mode: "raw",
      raw: JSON.stringify({
        amount: amount,
        country: "AR",
        currency: "ARS",
        payment_method: "cvu",
        merchant_transaction_reference: "{{CorrelationTransactionIdentifier}}",
        merchant_customer_id: "customer@email.com",
        allowOverUnder: allowOverUnder,
        fields: {
          first_name: "Jon",
          last_name: "Snow",
          document_number: "20275105792",
          document_type: "CUIL",
          email: "customer@email.com"
        }
      }, null, 4),
      options: { raw: { language: "json" } }
    }
  }
});

const createSimulatorRequest = (name, amount, cuit = "20275105792") => ({
  name,
    request: {
      method: "POST",
      header: [
        { key: "Authorization", value: "Bearer {{DINARIA_SANDBOX_TOKEN}}", type: "text" },
        { key: "Content-Type", value: "application/json", type: "text" }
      ],
      url: { raw: "{{DINARIA_SANDBOX_URL}}", host: ["{{DINARIA_SANDBOX_URL}}"] },
      body: {
        mode: "raw",
        raw: JSON.stringify({
          cbu: "{{EXTRACTED_CVU}}",
          cuit: cuit,
          amount: amount.toFixed(2),
          idTrxCliente: "{{EXTRACTED_REF}}",
          nombre: "Jon Snow"
        }, null, 4),
        options: { raw: { language: "json" } }
      }
    }
});

const createStatusRequest = (name) => ({
  name,
  request: {
    method: "GET",
    header: [
      { key: "Authorization", value: "Bearer {{AccessToken}}", type: "text" },
      { key: "Content-Type", value: "application/json", type: "text" }
    ],
    url: { raw: "{{BASE_URL}}/v2/transactions/pay-in/{{TRANSACTION_ID}}", host: ["{{BASE_URL}}"], path: ["v2", "transactions", "pay-in", "{{TRANSACTION_ID}}"] }
  }
});

const scenarios = [
  {
    name: "1. Pago Exacto", folder: [
      createPayinRequest("1. Create PayIn (1500, aOU:true)", 1500, true),
      createSimulatorRequest("2. Simular Abono Exacto (1500)", 1500),
      createStatusRequest("3. Consultar Estado PayIn")
    ]
  },
  {
    name: "2. Under Pay Permitido", folder: [
      createPayinRequest("1. Create PayIn (1500, aOU:true)", 1500, true),
      createSimulatorRequest("2. Simular Abono Menor (1000)", 1000),
      createStatusRequest("3. Consultar Estado PayIn")
    ]
  },
  {
    name: "3. Rechazo Estricto (Under Pay Falso)", folder: [
      createPayinRequest("1. Create PayIn (1000, aOU:false)", 1000, false),
      createSimulatorRequest("2. Simular Abono Menor y Rebotar (800)", 800),
      createStatusRequest("3. Consultar Estado PayIn")
    ]
  },
  {
    name: "4. Over Pay Permitido", folder: [
      createPayinRequest("1. Create PayIn (1500, aOU:true)", 1500, true),
      createSimulatorRequest("2. Simular Abono Mayor (2500)", 2500),
      createStatusRequest("3. Consultar Estado PayIn")
    ]
  },
  {
    name: "5. Exact Match (Strict)", folder: [
      createPayinRequest("1. Create PayIn (1500, aOU:false)", 1500, false),
      createSimulatorRequest("2. Simular Abono Exacto (1500)", 1500),
      createStatusRequest("3. Consultar Estado PayIn")
    ]
  },
  {
    name: "6. Sobrepago Bloqueado Estricto", folder: [
      createPayinRequest("1. Create PayIn (1000, aOU:false)", 1000, false),
      createSimulatorRequest("2. Simular Abono Mayor y Rebotar (1200)", 1200),
      createStatusRequest("3. Consultar Estado PayIn")
    ]
  },
  {
    name: "7. Pagos Parciales Acumulativos (Multi)", folder: [
      createPayinRequest("1. Create PayIn (2000, aOU:true)", 2000, true),
      createSimulatorRequest("2. Simular 1er Mitad (1000)", 1000),
      createStatusRequest("3. Consultar Estado PayIn Intermedio"),
      createSimulatorRequest("4. Simular 2da Mitad (1000)", 1000),
      createStatusRequest("5. Consultar Estado PayIn Final")
    ]
  },
  {
    name: "8. Webhooks Duplicados (Idempotencia)", folder: [
      createPayinRequest("1. Create PayIn (1000, aOU:true)", 1000, true),
      createSimulatorRequest("2. Simular Abono #1 (1000)", 1000),
      createSimulatorRequest("3. Simular Abono #2 (1000)", 1000),
      createStatusRequest("4. Consultar Estado PayIn")
    ]
  },
  {
    name: "10. Mismatch de CUIT", folder: [
      createPayinRequest("1. Create PayIn (1500, aOU:true)", 1500, true),
      createSimulatorRequest("2. Simular Abono Mismatch CUIT (1500)", 1500, "20111111112"),
      createStatusRequest("3. Consultar Estado PayIn")
    ]
  }
];

scenarios.forEach(s => {
  collection.item.push({
    name: s.name,
    item: s.folder
  });
});

const outPath = path.join(__dirname, '_qa_docs', 'Dinaria', 'Dinaria_AR_Cashin_Scenarios_v2.postman_collection.json');
fs.writeFileSync(outPath, JSON.stringify(collection, null, 2), 'utf-8');
console.log(`Colección Postman generada exitosamente en: ${outPath}`);
