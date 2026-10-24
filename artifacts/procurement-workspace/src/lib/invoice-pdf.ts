/** Capture the invoice sheet only, retaining Unicode text and both saved signatures. */
export async function downloadInvoicePdf(element: HTMLElement, reference: string) {
  await document.fonts.ready;
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  const canvas = await toCanvas(element, {
    pixelRatio: 2,
    backgroundColor: "#fffdf8",
    filter: (node) => !(node instanceof HTMLElement && node.classList.contains("no-print")),
  });
  if (!canvas.width || !canvas.height) throw new Error("The invoice could not be rendered.");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 12;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  const height = pdf.internal.pageSize.getHeight() - margin * 2;
  const sliceHeight = Math.floor(height / width * canvas.width);
  const bounds = element.getBoundingClientRect();
  const scale = canvas.height / bounds.height;
  const records = Array.from(element.querySelectorAll(".invoice-signature-record")).map(node => {
    const rect = node.getBoundingClientRect();
    return { top: Math.round((rect.top - bounds.top) * scale), bottom: Math.round((rect.bottom - bounds.top) * scale) };
  });
  for (let top = 0; top < canvas.height;) {
    if (top) pdf.addPage();
    let bottom = Math.min(top + sliceHeight, canvas.height);
    // Keep evidence together when it fits on a fresh page. Oversized evidence
    // still spans slices without dropping any pixels or looping indefinitely.
    const crossing = records.find(record => record.top > top && record.top < bottom && record.bottom > bottom
      && record.bottom - record.top <= sliceHeight);
    if (crossing) bottom = crossing.top;
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = bottom - top;
    const context = slice.getContext("2d");
    if (!context) throw new Error("Your browser could not create the PDF image.");
    context.drawImage(canvas, 0, top, canvas.width, slice.height, 0, 0, slice.width, slice.height);
    pdf.addImage(slice.toDataURL("image/png"), "PNG", margin, margin, width, slice.height / slice.width * width);
    top = bottom;
  }
  pdf.setProperties({ title: reference, subject: "Internal invoice record", creator: "Procurement workspace" });
  pdf.save(`${reference.replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`);
}
