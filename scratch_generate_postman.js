const fs = require('fs');
const path = require('path');

const collection = {
  info: {
    name: "Dinaria AR Cash-In Scenarios",
    description: "Colección para probar manualmente los flujos y casos borde del Webhook de Dinaria.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  variable: [
    { key: "BASE_URL", value: "https://api.v2.dev.paypaga.com", type: "string" },
    { key: "TOKEN", value: "TU_TOKEN_PAYPAGA", type: "string" },
    { key: "DINARIA_SANDBOX_URL", value: "https://api.sandbox.dinaria.com/ars/cashin/simulate", type: "string" },
    { key: "DINARIA_SANDBOX_TOKEN", value: "di_sand_reg_paypaga_merch", type: "string" },
    { key: "EXTRACTED_CVU", value: "PEGAR_CVU_AQUI", type: "string" },
    { key: "EXTRACTED_REF", value: "PEGAR_REF_AQUI", type: "string" }
  ],
  item: []
};

const createPayinRequest = (name, amount, allowOverUnder) => ({
  name,
  request: {
    method: "POST",
    header: [
      { key: "DisablePartnerMock", value: "true", type: "text" },
      { key: "Authorization", value: "Bearer {{TOKEN}}", type: "text" },
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
        merchant_transaction_reference: `MANUAL-POSTMAN-${Date.now()}`,
        merchant_customer_id: "dinaria_sandbox@paypaga.com",
        allowOverUnder: allowOverUnder,
        fields: {
          first_name: "Jon",
          last_name: "Snow",
          document_number: "20275105792",
          document_type: "CUIL",
          email: "dinaria_sandbox@paypaga.com"
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

const scenarios = [
  {
    name: "1. Pago Exacto", folder: [
      createPayinRequest("1. Create PayIn (1500, aOU:true)", 1500, true),
      createSimulatorRequest("2. Simular Abono (1500)", 1500)
    ]
  },
  {
    name: "2. Under Pay Permitido", folder: [
      createPayinRequest("1. Create PayIn (1500, aOU:true)", 1500, true),
      createSimulatorRequest("2. Simular Abono Menor (1000)", 1000)
    ]
  },
  {
    name: "3. Rechazo Estricto (Under Pay Falso)", folder: [
      createPayinRequest("1. Create PayIn (1000, aOU:false)", 1000, false),
      createSimulatorRequest("2. Simular Abono Menor y Rebotar (800)", 800)
    ]
  },
  {
    name: "4. Over Pay Permitido", folder: [
      createPayinRequest("1. Create PayIn (1500, aOU:true)", 1500, true),
      createSimulatorRequest("2. Simular Abono Mayor (2500)", 2500)
    ]
  },
  {
    name: "5. Exact Match (Strict)", folder: [
      createPayinRequest("1. Create PayIn (1500, aOU:false)", 1500, false),
      createSimulatorRequest("2. Simular Abono Exacto (1500)", 1500)
    ]
  },
  {
    name: "6. Sobrepago Bloqueado Estricto", folder: [
      createPayinRequest("1. Create PayIn (1000, aOU:false)", 1000, false),
      createSimulatorRequest("2. Simular Abono Mayor y Rebotar (1200)", 1200)
    ]
  },
  {
    name: "7. Pagos Parciales Acumulativos (Multi)", folder: [
      createPayinRequest("1. Create PayIn (2000, aOU:true)", 2000, true),
      createSimulatorRequest("2. Simular 1er Mitad (1000)", 1000),
      createSimulatorRequest("3. Simular 2da Mitad (1000)", 1000)
    ]
  },
  {
    name: "8. Webhooks Duplicados (Idempotencia)", folder: [
      createPayinRequest("1. Create PayIn (1000, aOU:true)", 1000, true),
      createSimulatorRequest("2. Simular Abono #1 (1000)", 1000),
      createSimulatorRequest("3. Simular Abono #2 (1000)", 1000)
    ]
  },
  {
    name: "10. Mismatch de CUIT", folder: [
      createPayinRequest("1. Create PayIn (1500, aOU:true)", 1500, true),
      createSimulatorRequest("2. Simular Abono Mismatch CUIT (1500)", 1500, "20111111112")
    ]
  }
];

scenarios.forEach(s => {
  collection.item.push({
    name: s.name,
    item: s.folder
  });
});

const outPath = path.join(__dirname, '_qa_docs', 'Dinaria', 'Dinaria_AR_Cashin_Scenarios.postman_collection.json');
fs.writeFileSync(outPath, JSON.stringify(collection, null, 2), 'utf-8');
console.log(`Colección Postman generada exitosamente en: ${outPath}`);
