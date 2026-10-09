import { toCsv } from './reporting-csv.util';

interface Row {
  name: string;
  amount: number;
}

describe('toCsv', () => {
  it('renders a header row followed by one line per row', () => {
    const csv = toCsv<Row>(
      [
        { key: 'name', label: 'Name' },
        { key: 'amount', label: 'Amount' },
      ],
      [
        { name: 'Alice', amount: 100 },
        { name: 'Bob', amount: 200 },
      ],
    );
    expect(csv).toBe('Name,Amount\r\nAlice,100\r\nBob,200');
  });

  it('quotes a field containing a comma, quote, or newline', () => {
    const csv = toCsv<Row>(
      [{ key: 'name', label: 'Name' }],
      [{ name: 'Smith, John "Jack"', amount: 0 }],
    );
    expect(csv).toBe('Name\r\n"Smith, John ""Jack"""');
  });

  it('neutralizes a leading = + - @ as spreadsheet formula injection, by prefixing a quote', () => {
    const cases = ['=1+1', '+1+1', '-1+1', '@SUM(A1)'];
    for (const value of cases) {
      const csv = toCsv<Row>([{ key: 'name', label: 'Name' }], [{ name: value, amount: 0 }]);
      expect(csv).toBe(`Name\r\n'${value}`);
    }
  });

  it('leaves an ordinary negative number (via a value() formatter, not raw string) untouched', () => {
    const csv = toCsv<{ amount: number }>(
      [{ key: 'amount', label: 'Amount', value: (row) => row.amount }],
      [{ amount: -50 }],
    );
    expect(csv).toBe('Amount\r\n-50');
  });

  it('renders null/undefined as an empty cell, never the literal string "null"', () => {
    const csv = toCsv<{ name: string | null }>(
      [{ key: 'name', label: 'Name', value: (row) => row.name }],
      [{ name: null }],
    );
    expect(csv).toBe('Name\r\n');
  });

  it('uses a custom value() formatter when supplied, over the raw row property', () => {
    const csv = toCsv<Row>(
      [{ key: 'amount', label: 'Amount', value: (row) => `$${row.amount.toFixed(2)}` }],
      [{ name: 'x', amount: 1234.5 }],
    );
    expect(csv).toBe('Amount\r\n$1234.50');
  });

  it('renders zero rows as just the header', () => {
    const csv = toCsv<Row>([{ key: 'name', label: 'Name' }], []);
    expect(csv).toBe('Name');
  });
});
