mkdir tests\EC
mkdir tests\EC\DoPayment
mkdir tests\EC\DoPayment\Payin
mkdir tests\EC\DoPayment\Payin\H2H
mkdir tests\EC\DoPayment\Payin\PayURL
mkdir tests\EC\DoPayment\Payin\MerchantPortal
mkdir tests\EC\DoPayment\Payout
mkdir tests\EC\DoPayment\Payout\H2H
mkdir tests\EC\DoPayment\Payout\MerchantPortal

move tests\payin\validations\payinH2H_EC.test.js tests\EC\DoPayment\Payin\H2H\payin_h2h_val.test.js
move tests\payin\e2e_ui\payurl_EC_interactivity.test.js tests\EC\DoPayment\Payin\PayURL\payurl_ui_val.test.js
move tests\payin\validations\payurl_EC.test.js tests\EC\DoPayment\Payin\PayURL\payurl_api_val.test.js
move tests\payin\e2e_ui\paymentlink_merchant_EC_interactivity.test.js tests\EC\DoPayment\Payin\MerchantPortal\merchant_payin_ui_val.test.js
move tests\payin\e2e_ui\paymentlink_merchant_EC.test.js tests\EC\DoPayment\Payin\MerchantPortal\merchant_payin_api_val.test.js
move tests\payout\validations\payout_H2H_EC.test.js tests\EC\DoPayment\Payout\H2H\payout_h2h_val.test.js
move tests\payout\e2e_ui\payout_merchant_EC_interactivity.test.js tests\EC\DoPayment\Payout\MerchantPortal\merchant_payout_ui_val.test.js
move tests\payout\e2e_ui\payout_merchant_EC.flow.test.js tests\EC\DoPayment\Payout\MerchantPortal\merchant_payout_flow.test.js
move tests\payin\validations\config_EC.test.js tests\EC\DoPayment\Payin\config_EC.test.js
move tests\payin\validations\config_AR.test.js tests\EC\DoPayment\Payin\config_AR.test.js
