import assert from 'node:assert/strict';

// Minimal stored ZIP with valid CRCs; all cells are explicit inline strings.
export function fictionalMigrationXlsx(csv){
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  assert.ok(!csv.includes('"'),'fixture supports only unquoted fictional cells');
  const rows=csv.trimEnd().split('\n').map((line,i)=>'<row r="'+(i+1)+'">'+line.split(',').map(value=>'<c t="inlineStr"><is><t>'+escape(value)+'</t></is></c>').join('')+'</row>').join('');
  const entries={'xl/workbook.xml':'<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Fictional" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':'<worksheet><sheetData>'+rows+'</sheetData></worksheet>'};
  const local=[],central=[];let offset=0;
  for(const [name,text] of Object.entries(entries)){
    const n=Buffer.from(name),data=Buffer.from(text);let crc=0xffffffff;
    for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt32LE(crc,14);l.writeUInt32LE(data.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    local.push(l,n,data);central.push(c,n);offset+=l.length+n.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(3,8);end.writeUInt16LE(3,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
