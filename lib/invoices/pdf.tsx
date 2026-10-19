import path from "node:path";
import {
  Document,
  Image,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { invoices } from "@/lib/db/schema";
import {
  formatAmountSgd,
  formatDueDateLong,
  formatInvoiceDateShort,
  formatServiceMonthLabel,
} from "@/lib/invoices/format";

type Invoice = typeof invoices.$inferSelect;

// `process.cwd()` is the project root for `next dev`/`build`/`start` (same
// reasoning as lib/db/client.ts) rather than a path relative to this file,
// which would break once webpack bundles this module into a different
// directory structure.
const LOGO_PATH = path.resolve(process.cwd(), "public/invoice/logo.png");
const PAYNOW_QR_PATH = path.resolve(process.cwd(), "public/invoice/paynow-qr.png");

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  logo: {
    width: 60,
    height: 59,
  },
  invoiceLabel: {
    marginTop: 6,
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
  },
  letterheadBlock: {
    alignItems: "flex-end",
  },
  companyName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginBottom: 4,
  },
  letterheadLine: {
    textAlign: "right",
  },
  metaBlock: {
    marginTop: 10,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  metaLabel: {
    width: 70,
    textAlign: "right",
    marginRight: 8,
  },
  metaValue: {
    width: 130,
    textAlign: "right",
  },
  addressBlock: {
    marginTop: 30,
  },
  addressLine: {
    marginBottom: 2,
  },
  table: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    paddingVertical: 6,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 10,
    minHeight: 50,
  },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    paddingVertical: 6,
  },
  colDescription: {
    flex: 3,
    paddingRight: 8,
  },
  colTax: {
    flex: 1,
    textAlign: "center",
  },
  colAmount: {
    flex: 1,
    textAlign: "right",
  },
  tableHeaderText: {
    fontFamily: "Helvetica-Bold",
  },
  descriptionSub: {
    marginTop: 4,
    color: "#444444",
  },
  totalLabel: {
    flex: 4,
    textAlign: "right",
    fontFamily: "Helvetica-Bold",
    paddingRight: 8,
  },
  totalAmount: {
    flex: 1,
    textAlign: "right",
    fontFamily: "Helvetica-Bold",
  },
  dueDateRow: {
    marginTop: 20,
  },
  paymentSection: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  paymentDetails: {
    flexShrink: 1,
  },
  paymentHeading: {
    marginBottom: 6,
    fontFamily: "Helvetica-Bold",
  },
  paymentLine: {
    marginBottom: 2,
  },
  paynowQr: {
    width: 80,
    height: 80,
    marginLeft: 16,
  },
  latePaymentSection: {
    marginTop: 24,
  },
  latePaymentHeading: {
    marginBottom: 4,
    fontFamily: "Helvetica-Bold",
  },
  latePaymentLine: {
    marginBottom: 2,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: "center",
    color: "#555555",
    fontSize: 8,
  },
});

function InvoiceDocument({ invoice }: { invoice: Invoice }) {
  const serviceFeesDescription = `Service Fees - ${formatServiceMonthLabel(invoice.invoiceDate)}`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Image style={styles.logo} src={LOGO_PATH} />
            <Text style={styles.invoiceLabel}>INVOICE</Text>
          </View>
          <View style={styles.letterheadBlock}>
            <Text style={styles.companyName}>ARCSOCIAL PTE LTD</Text>
            <Text style={styles.letterheadLine}>Co. Reg No: 202605753K</Text>
            <Text style={styles.letterheadLine}>E-mail: business@arcsocialsg.com</Text>
            <Text style={styles.letterheadLine}>Contact No: 8883 7487 (Kash)</Text>
            <Text style={styles.letterheadLine}>            8261 0777 (Callum)</Text>

            <View style={styles.metaBlock}>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Invoice Date</Text>
                <Text style={styles.metaValue}>{formatInvoiceDateShort(invoice.invoiceDate)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Invoice No</Text>
                <Text style={styles.metaValue}>{invoice.invoiceNumber}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Attention</Text>
                <Text style={styles.metaValue}>{invoice.clientAttention}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.addressBlock}>
          <Text style={styles.addressLine}>{invoice.clientLegalName}</Text>
          <Text style={styles.addressLine}>{invoice.clientAddressLine1}</Text>
          {invoice.clientAddressLine2 != null && (
            <Text style={styles.addressLine}>{invoice.clientAddressLine2}</Text>
          )}
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.colDescription, styles.tableHeaderText]}>Description</Text>
            <Text style={[styles.colTax, styles.tableHeaderText]}>Tax</Text>
            <Text style={[styles.colAmount, styles.tableHeaderText]}>Amount (SGD)</Text>
          </View>
          <View style={styles.tableRow}>
            <View style={styles.colDescription}>
              <Text>{serviceFeesDescription}</Text>
              {invoice.description != null && invoice.description !== "" && (
                <Text style={styles.descriptionSub}>{invoice.description}</Text>
              )}
            </View>
            <Text style={styles.colTax}>No Tax</Text>
            <Text style={styles.colAmount}>$ {formatAmountSgd(invoice.totalAmountCents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total (SGD)</Text>
            <Text style={styles.totalAmount}>$ {formatAmountSgd(invoice.totalAmountCents)}</Text>
          </View>
        </View>

        <View style={styles.dueDateRow}>
          <Text>Due Date: {formatDueDateLong(invoice.dueDate)}</Text>
        </View>

        <View style={styles.paymentSection}>
          <View style={styles.paymentDetails}>
            <Text style={styles.paymentHeading}>Payment to be remitted to:</Text>
            <Text style={styles.paymentLine}>Bank Name: OCBC BANK LTD</Text>
            <Text style={styles.paymentLine}>Beneficiary&apos;s Name: ARC SOCIAL PTE LTD</Text>
            <Text style={styles.paymentLine}>Account No: 701635377001</Text>
            <Text style={styles.paymentLine}>Paynow UEN: 202605753K</Text>
          </View>
          <Image style={styles.paynowQr} src={PAYNOW_QR_PATH} />
        </View>

        <View style={styles.latePaymentSection}>
          <Text style={styles.latePaymentHeading}>Late Payment Policy:</Text>
          <Text style={styles.latePaymentLine}>
            ~ For payments received 1–7 days past the due date, a 1% late fee will be applied to the outstanding amount.
          </Text>
          <Text style={styles.latePaymentLine}>
            ~ For payments received more than 7 days past the due date, a 5% late fee will be applied to the outstanding amount.
          </Text>
          <Text style={styles.latePaymentLine}>
            ~ Applicable late fees will be reflected in the subsequent invoice, where relevant.
          </Text>
        </View>

        <Text style={styles.footer}>
          This is a computer generated invoice, no signature is required.
        </Text>
      </Page>
    </Document>
  );
}

/** Renders `invoice` into a complete PDF file as an in-memory Buffer. */
export async function renderInvoicePdfBuffer(invoice: Invoice): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument invoice={invoice} />);
}
