const axios = require('axios');
async function research() {
    try {
        const payload = {
            "country": "EC",
            "currency": "USD",
            "amount": 100.00,
            "merchant_transaction_reference": "PoUrl-TEST-" + Date.now(),
            "merchant_customer_id": "cliente_ec@ejemplo.com",
            "allowed_payment_methods": [ "bank_transfer" ],
            "predefined_fields": [] // Vacío para forzar formulario
        };

        const postRes = await axios.post('https://api.v2.stg.paypaga.com/v2/pay-urls', payload, {
            headers: {
                'DisablePartnerMock': 'true',
                'Content-Type': 'application/json',
                'Authorization': 'Bearer eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NzQ5MDQ3ODIsImlhdCI6MTc3NDkwNDQ4MiwibWlkIjoiMjcyMTI4MWItZWNkZS00MzdkLTg0M2YtY2Y0NTdlYzdjNDUwIiwidGlkIjoiNzc5YjUxMjEtMzQyYS00YjE0LTg1MmEtMTA4N2E2MmQ1MDVkIn0.moESsyo_W1Y_3yN3JrMP4gcQHQo8rBp2GkDtsfv38n6gGxv9TyavVIwGyiE76d1teHo_i5oiaJ4AaNRf_P_JrSaobBjFC_0dXtHIY0GEKqs1U5nVBmNIuC10fIHpz5_vcRUo6EqDaGQ_lN_hYGrsVna_WvkeN2yD92m4JxT6XuB6sSf3hA2HTFs66wT_K1Dcad2rKNxkykMqAqZ4W-n8J941XluZdkY-nfQxVtiXSL_di-1_6p6iJZ6wO9WalA1uo7JplBxT8fxIGYkt-KW9HNU98dYgjsEAxGxX8OCr9lBaUUCnd-eqaTgFN1tBko2FtzJ_dfkC8VO6OgXgLo_Y9w'
            },
            validateStatus: () => true
        });

        const url = postRes.data.pay_url;
        console.log("PAY URL:", url);
        if (!url) return;

        const getRes = await axios.get(url, { headers: { 'Accept-Language': 'es-ES' } });
        const html = getRes.data;
        
        console.log("Tiene first_name?", html.includes('id="first_name"'));
        console.log("Tiene form input-dynamic?", html.includes('form-input input-dynamic'));
        console.log("Tiene button disabled?", html.includes('disabled=""'));
        console.log("Longitud HTML:", html.length);
    } catch (e) { console.error(e.message); }
}
research();
