// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import HealthSummaryPdf, { type HealthSummaryPdfProps } from './HealthSummaryPdf';
import pagination from './fixtures/pagination.json';

// Fictional records reproduce a real page-boundary failure: a nested clipped
// table produced enormous translation coordinates and hid an entire dose event.
// Check the rendered document, rather than matching its React element layout.
describe('doctor PDF pagination', () => {
  it('keeps all drawing transforms finite and bounded for multi-page clinical and scan history', async () => {
    const document = await PDFDocument.load(
      await renderToBuffer(
        <HealthSummaryPdf {...(pagination as unknown as HealthSummaryPdfProps)} />
      )
    );
    expect(document.getPageCount()).toBeGreaterThan(1);
    const number = '([-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?)';
    const transform = new RegExp(Array(6).fill(number).join('\\s+') + '\\s+cm\\b', 'g');
    let transforms = 0;
    for (const page of document.getPages()) {
      const contents = page.node.Contents();
      const streams =
        contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
      for (const reference of streams) {
        const stream = document.context.lookup(reference);
        if (!(stream instanceof PDFRawStream)) throw new Error('Expected a PDF content stream');
        const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
        for (const match of operators.matchAll(transform)) {
          transforms += 1;
          for (const coordinate of match.slice(1).map(Number)) {
            expect(Number.isFinite(coordinate)).toBe(true);
            expect(Math.abs(coordinate)).toBeLessThan(10_000);
          }
        }
      }
    }
    expect(transforms).toBeGreaterThan(100);
  }, 15_000);
});
