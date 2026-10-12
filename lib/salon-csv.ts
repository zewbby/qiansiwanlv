export function csvCell(value:string|number,column:number):string {
  const text=String(value);
  // Money columns must remain numeric, including negative reversal postings.
  const numericMoney=column>=5 && column<=9 && /^-?\d+(\.\d{1,2})?$/.test(text);
  const safe=/^[=+\-@\t\r]/.test(text) && !numericMoney ? "'"+text:text;
  return `"${safe.replaceAll('"','""')}"`;
}
