const axios = require('axios');

async function checkUrlHtml() {
    try {
        console.log("Generando PayURL con monto 0...");
        const payload = {
            "country": "EC",
            "currency": "USD",
            "amount": 0,
            "merchant_transaction_reference": "PoUrl-TEST-" + Date.now(),
            "merchant_customer_id": "cliente_ec@ejemplo.com",
            "allowed_payment_methods": [ "bank_transfer" ],
            "predefined_fields": [
              {
                "payment_method": "bank_transfer",
                "fields": { "first_name": "Sergio", "last_name": "Test", "email": "serrigo@paypaga.com", "document_type": "CI", "document_number": "1307990091" }
              }
            ]
        };

        const postRes = await axios.post('https://api.v2.stg.paypaga.com/v2/pay-urls', payload, {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': 'Bearer eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NzQ5MDQ3ODIsImlhdCI6MTc3NDkwNDQ4MiwibWlkIjoiMjcyMTI4MWItZWNkZS00MzdkLTg0M2YtY2Y0NTdlYzdjNDUwIiwidGlkIjoiNzc5YjUxMjEtMzQyYS00YjE0LTg1MmEtMTA4N2E2MmQ1MDVkIn0.moESsyo_W1Y_3yN3JrMP4gcQHQo8rBp2GkDtsfv38n6gGxv9TyavVIwGyiE76d1teHo_i5oiaJ4AaNRf_P_JrSaobBjFC_0dXtHIY0GEKqs1U5nVBmNIuC10fIHpz5_vcRUo6EqDaGQ_lN_hYGrsVna_WvkeN2yD92m4JxT6XuB6sSf3hA2HTFs66wT_K1Dcad2rKNxkykMqAqZ4W-n8J941XluZdkY-nfQxVtiXSL_di-1_6p6iJZ6wO9WalA1uo7JplBxT8fxIGYkt-KW9HNU98dYgjsEAxGxX8OCr9lBaUUCnd-eqaTgFN1tBko2FtzJ_dfkC8VO6OgXgLo_Y9w'
            },
            validateStatus: () => true
        });

        const payUrl = postRes.data.pay_url;
        console.log("Pay URL obtenida:", payUrl);

        if (!payUrl) return console.log("No se devolvió pay_url");

        const getRes = await axios.get(payUrl, {
            headers: { 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' }
        });

        const html = getRes.data;
        const target = "El monto debe ser mayor";
        if (html.includes(target)) {
            console.log("\n✅ ¡ÉXITO! El error viaja incrustado en el HTML directo. No necesitamos Puppeteer.");
        } else if (html.includes('Errores de validaci')) {
            console.log("\n✅ Está el título 'Errores de validación' pero no el string exacto.");
        } else {
            console.log("\n❌ FRACASO: El texto no está en el HTML plano. Es una SPA (React/Angular) que lo carga después con JS. Necesitaremos Puppeteer.");
        }
    } catch (e) {
        console.error("ERROR:", e.message);
    }
}
checkUrlHtml();
