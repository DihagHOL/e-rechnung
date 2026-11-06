// node tests/positionszuschlag.test.js
// Zu- und Abschläge an der Position (BG-27, BG-28): Das lesbare PDF zeigt den Warenwert und jeden Posten.
const assert = require('assert');
const path = require('path');
require(path.join(__dirname, '../api/scripts/sync.js'));
const { convertXmlToPdf, parseInvoiceData } = require('../api/src/converter');
const { pdfText } = require('../api/src/pdftext');

let n = 0;
const gleich = (ist, soll, m) => { assert.deepStrictEqual(ist, soll, m + ': ' + JSON.stringify(ist)); n++; };

const zuAbCii = (zuschlag, betrag, grund) => `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>${zuschlag}</udt:Indicator></ram:ChargeIndicator>`
  + `<ram:ActualAmount>${betrag}</ram:ActualAmount>${grund ? `<ram:Reason>${grund}</ram:Reason>` : ''}</ram:SpecifiedTradeAllowanceCharge>`;

const zeileCii = (nr, name, menge, preis, summe, zuAb) => `<ram:IncludedSupplyChainTradeLineItem>
  <ram:AssociatedDocumentLineDocument><ram:LineID>${nr}</ram:LineID></ram:AssociatedDocumentLineDocument>
  <ram:SpecifiedTradeProduct><ram:Name>${name}</ram:Name></ram:SpecifiedTradeProduct>
  <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${preis}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
  <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="H87">${menge}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
  <ram:SpecifiedLineTradeSettlement>
    <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>19.00</ram:RateApplicablePercent></ram:ApplicableTradeTax>
    ${zuAb}
    <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${summe}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
  </ram:SpecifiedLineTradeSettlement>
</ram:IncludedSupplyChainTradeLineItem>`;

const cii = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocument><ram:ID>RE-7001</ram:ID><ram:TypeCode>380</ram:TypeCode></rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${zeileCii('10', 'Schalter', '2.000', '257.000', '537.54', zuAbCii('true', '23.54', 'Fracht'))}
${zeileCii('20', 'Sensor', '1.000', '100.000', '90.00', zuAbCii('false', '10.00', 'Rabatt'))}
${zeileCii('30', 'Kabel', '3.000', '10.000', '30.00', '')}
${zeileCii('40', 'Halter', '1.000', '50.000', '55.00', zuAbCii('true', '5.00', ''))}
<ram:ApplicableHeaderTradeAgreement><ram:SellerTradeParty><ram:Name>Muster Mess GmbH</ram:Name></ram:SellerTradeParty><ram:BuyerTradeParty><ram:Name>Kunde AG</ram:Name></ram:BuyerTradeParty></ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery/>
<ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>712.54</ram:LineTotalAmount><ram:TaxBasisTotalAmount>712.54</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">135.38</ram:TaxTotalAmount><ram:GrandTotalAmount>847.92</ram:GrandTotalAmount><ram:DuePayableAmount>847.92</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

const ubl = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:ID>RE-7002</cbc:ID><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
<cac:AccountingSupplierParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Muster Mess GmbH</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Kunde AG</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">537.54</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">537.54</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">639.67</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">639.67</cbc:PayableAmount></cac:LegalMonetaryTotal>
<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="H87">2</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">537.54</cbc:LineExtensionAmount>
<cac:AllowanceCharge><cbc:ChargeIndicator>true</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Fracht</cbc:AllowanceChargeReason><cbc:Amount currencyID="EUR">23.54</cbc:Amount></cac:AllowanceCharge>
<cac:Item><cbc:Name>Schalter</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item>
<cac:Price><cbc:PriceAmount currencyID="EUR">257</cbc:PriceAmount><cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="EUR">3</cbc:Amount><cbc:BaseAmount currencyID="EUR">260</cbc:BaseAmount></cac:AllowanceCharge></cac:Price>
</cac:InvoiceLine>
</Invoice>`;

(async () => {
  // Lesen
  const d = parseInvoiceData(cii);
  gleich(d.positionen.map(p => [p.gesamt, p.zuAbschlaege]), [
    [537.54, [{ zuschlag: true, betrag: 23.54, grund: 'Fracht' }]],
    [90, [{ zuschlag: false, betrag: 10, grund: 'Rabatt' }]],
    [30, []],
    [55, [{ zuschlag: true, betrag: 5, grund: '' }]],
  ], 'CII: Zu- und Abschläge je Position');

  const u = parseInvoiceData(ubl);
  gleich(u.positionen[0].zuAbschlaege, [{ zuschlag: true, betrag: 23.54, grund: 'Fracht' }], 'UBL: nur an der Zeile, nicht der Preisnachlass');

  // Lesbares PDF: Warenwert in der Zeile, darunter der Posten, die Summe bleibt
  const text = (await pdfText(Buffer.from((await convertXmlToPdf(cii)).pdf), { maxSeiten: 5 })).text.replace(/\s+/g, ' ');
  gleich(/Schalter.*514,00 €/.test(text), true, 'Warenwert 2 × 257,00 = 514,00');
  gleich(/zzgl\. Fracht 23,54 €/.test(text), true, 'Fracht als eigener Posten');
  gleich(/Sensor.*100,00 €/.test(text) && /abzgl\. Rabatt -10,00 €/.test(text), true, 'Rabatt als Abzug');
  gleich(/Kabel.*30,00 €/.test(text), true, 'ohne Posten bleibt der Positionswert');
  gleich(/zzgl\. Zuschlag 5,00 €/.test(text), true, 'ohne Grund');
  gleich(/537,54/.test(text.split('Nettobetrag')[0]), false, 'der Wert inklusive Fracht steht nicht mehr in der Zeile');
  gleich(/Nettobetrag 712,54 €/.test(text), true, 'Nettobetrag unverändert');

  console.log(`positionszuschlag: ${n} Prüfungen grün`);
})().catch(e => { console.error(e); process.exit(1); });
