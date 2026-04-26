const axios = require('axios');

class SandboxHelper {
    
    /**
     * Limpia todas las transacciones en estado 'started' para un merchant específico.
     * @param {string} token El Bearer Token (API Key) del Sandbox
     * @param {string} merchantName Nombre del merchant para mostrar en el log
     * @param {string} merchantIdQuery Parámetro opcional si el endpoint lo requiere
     * @param {object} auditLog Instancia opcional de AuditLogger para escribir en el reporte
     */
    static async cleanOrphanTransactions(token, merchantName, merchantIdQuery = null, auditLog = null) {
        let hasMore = true;
        let totalCancelled = 0;
        console.log(`🧹 Iniciando limpieza de Sandbox [Merchant: ${merchantName}] (Token: ${token.substring(0, 8)}...)`);

        while (hasMore) {
            try {
                let url = `https://api.sandbox.dinaria.com/payments?status=started`;
                if (merchantIdQuery) {
                    url += `&merchantId=${merchantIdQuery}`;
                }

                const res = await axios.get(url, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                // La API podría devolver un array directo o un objeto con "data" o "items"
                let transactions = [];
                if (Array.isArray(res.data)) {
                    transactions = res.data;
                } else if (res.data && Array.isArray(res.data.items)) {
                    transactions = res.data.items;
                } else if (res.data && Array.isArray(res.data.data)) {
                    transactions = res.data.data;
                }

                if (!transactions || transactions.length === 0) {
                    hasMore = false;
                    console.log(`✅ Limpieza completada para [Merchant: ${merchantName}]. Total canceladas: ${totalCancelled}`);
                    
                    if (auditLog) {
                        auditLog.logFlow(`[PRE-FLIGHT] Environment Cleanup: ${merchantName}`, {
                            "Target Merchant": merchantName,
                            "Action": "Cancel orphan transactions (status=started)",
                            "Transactions Cancelled": totalCancelled,
                            "Remaining 'started' state": 0
                        });
                    }
                    break;
                }

                console.log(`🗑️ Encontradas ${transactions.length} transacciones huérfanas. Cancelando lote...`);

                // Cancelar en paralelo el lote actual
                const cancelPromises = transactions.map(async (tx) => {
                    const txId = tx.transactionId || tx.id;
                    if (!txId) return;
                    
                    try {
                        await axios.post(`https://api.sandbox.dinaria.com/payments/${txId}/cancel`, {}, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        totalCancelled++;
                    } catch (err) {
                        console.error(`Error cancelando tx ${txId}:`, err.message);
                    }
                });

                await Promise.all(cancelPromises);

                // Esperar 1 segundo antes del siguiente lote para no rate-limitear la API
                await new Promise(r => setTimeout(r, 1000));

            } catch (error) {
                console.error(`❌ Error consultando Sandbox:`, error.response ? error.response.data : error.message);
                hasMore = false; // abortar bucle en caso de error fatal
            }
        }
    }

    /**
     * Consulta el estado final de una transacción en Sandbox usando el ID de la transacción (externalId).
     */
    static async getDinariaTransactionByExternalId(token, txId) {
        try {
            const res = await axios.get(`https://api.sandbox.dinaria.com/payments?limit=100`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            let items = [];
            if (res.data && Array.isArray(res.data.data)) items = res.data.data;
            else if (res.data && Array.isArray(res.data.items)) items = res.data.items;
            else if (Array.isArray(res.data)) items = res.data;
            
            const match = items.find(i => i.externalId === txId);
            return match || null;
        } catch (error) {
            console.error(`❌ Error buscando externalId ${txId}:`, error.response ? error.response.data : error.message);
            return null;
        }
    }
}

module.exports = SandboxHelper;
