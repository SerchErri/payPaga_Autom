const fs = require('fs');
const path = require('path');

const reportsDir = path.join(process.cwd(), 'audit_reports');
if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
}

class AuditLogger {
    constructor(testSuiteName) {
        const date = new Date();
        const timestamp = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}${date.getSeconds().toString().padStart(2, '0')}`;
        const sanitizedName = testSuiteName.replace(/[^a-zA-Z0-9_-]/g, '_');
        this.filePath = path.join(reportsDir, `${timestamp}_Audit_Report_${sanitizedName}.txt`);
        
        fs.writeFileSync(this.filePath, `=== SECURITY AUDIT LOG: ${testSuiteName} ===\n\n`);
        console.log(`[AuditLogger] Reporte de auditoría iniciado en: ${this.filePath}`);
        
        this._cleanupOldReports();
    }

    logSection(title) {
        const header = `\n================================================================================\n  ${title.toUpperCase()} \n================================================================================\n`;
        fs.appendFileSync(this.filePath, header);
    }

    logTestStart(testName) {
        const header = `\n--------------------------------------------------\n[TEST_START]: ${testName}\n--------------------------------------------------\n`;
        fs.appendFileSync(this.filePath, header);
    }

    _cleanupOldReports() {
        try {
            const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.txt'));
            if (files.length > 10) {
                files.sort(); // Sorting by YYYYMMDD prefix guarantees chronological order
                const filesToDelete = files.slice(0, files.length - 10);
                for (const file of filesToDelete) {
                    fs.unlinkSync(path.join(reportsDir, file));
                    console.log(`[AuditLogger] Robot de limpieza: Eliminado reporte antiguo -> ${file}`);
                }
            }
        } catch (e) {
            console.error(`[AuditLogger] Error en robot de limpieza:`, e.message);
        }
    }

    logTest(testId, testName, endpoint, payload, status, responseData, expectedToFail = true, overrideTxId = null) {
        let isPass = false;
        if (expectedToFail && status >= 400) isPass = true;
        if (!expectedToFail && status >= 200 && status < 300) isPass = true;

        const outcome = isPass ? "PASS" : "FAIL";

        let logEntry = `\n${testId} - ${testName} [${outcome}]\n`;
        logEntry += `[ENDPOINT]: ${endpoint}\n`;
        logEntry += `[Request]:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
        
        const txid = overrideTxId || responseData?.transaction_id || responseData?.details?.transaction_processed?.transaction_id || responseData?.id || "N/A";
        
        if (status >= 200 && status < 300) {
            // ACCEPTED
            logEntry += `\n[ACTUAL_RESULT]: ACCEPTED (HTTP ${status})\n`;
            logEntry += `[TX_ID]: ${txid}\n`;
            logEntry += `\n[Response]:\n\`\`\`json\n${JSON.stringify(responseData, null, 2)}\n\`\`\`\n`;
        } else {
            // REJECTED
            const errorMsg = JSON.stringify(responseData?.error || responseData?.error_details || responseData, null, 2);
            logEntry += `\n[ACTUAL_RESULT]: BLOCKED/REJECTED (HTTP ${status})\n`;
            logEntry += `[TX_ID]: ${txid}\n`;
            logEntry += `\n[Response]:\n\`\`\`json\n${errorMsg}\n\`\`\`\n`;
        }

        const isPayUrlOrPayin = this.filePath.toLowerCase().includes('payurl') || this.filePath.toLowerCase().includes('payin');
        
        if (isPayUrlOrPayin) {
            logEntry += `--------------------------------------------------\n`;
            const voucherLink = responseData?.pay_url || responseData?.url || responseData?.redirect_url || `https://api.v2.dev.paypaga.com/pay/${txid}`;
            logEntry += `VOUCHER VIEW LINK:\n${voucherLink}\n`;
            logEntry += `--------------------------------------------------\n`;
        }
        
        fs.appendFileSync(this.filePath, logEntry);
    }

    logFlow(testName, flowData) {
        let logEntry = `\n[FLOW_TEST]: ${testName}\n`;
        logEntry += `[FLOW_DATA]:\n\`\`\`json\n${JSON.stringify(flowData, null, 2)}\n\`\`\`\n`;
        logEntry += `--------------------------------------------------\n`;
        
        fs.appendFileSync(this.filePath, logEntry);
    }
}

module.exports = AuditLogger;
