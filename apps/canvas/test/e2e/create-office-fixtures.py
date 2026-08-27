#!/usr/bin/env python3
"""Create real Office and PDF fixtures for the ONLYOFFICE read-only preview E2E job.

LibreOffice is used only to author the test inputs. The application itself
always renders these files with the real ONLYOFFICE Document Server.
"""
from pathlib import Path
from shutil import copy2
from subprocess import run
from zipfile import ZIP_DEFLATED, ZipFile
import sys

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)

CONTENT_TYPES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  {defaults}
  {overrides}
</Types>'''
RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{relationships}</Relationships>'''

def write(name, parts):
    with ZipFile(out / name, 'w', ZIP_DEFLATED) as archive:
        for path, contents in parts.items():
            archive.writestr(path, contents)

def rel(identifier, kind, target):
    return f'<Relationship Id="{identifier}" Type="{kind}" Target="{target}"/>'

write('fixture.docx', {
    '[Content_Types].xml': CONTENT_TYPES.format(
        defaults='<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>',
        overrides='<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'),
    '_rels/.rels': RELS.format(relationships=rel('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'word/document.xml')),
    'word/document.xml': '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Dream Weave DOCX fixture</w:t></w:r></w:p><w:sectPr/></w:body></w:document>''',
})

write('fixture.xlsx', {
    '[Content_Types].xml': CONTENT_TYPES.format(
        defaults='<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>',
        overrides='<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'),
    '_rels/.rels': RELS.format(relationships=rel('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'xl/workbook.xml')),
    'xl/workbook.xml': '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>''',
    'xl/_rels/workbook.xml.rels': RELS.format(relationships=rel('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', 'worksheets/sheet1.xml')),
    'xl/worksheets/sheet1.xml': '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Dream Weave XLSX fixture</t></is></c></row></sheetData></worksheet>''',
})

write('fixture.pptx', {
    '[Content_Types].xml': CONTENT_TYPES.format(
        defaults='<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>',
        overrides='<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'),
    '_rels/.rels': RELS.format(relationships=rel('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'ppt/presentation.xml')),
    'ppt/presentation.xml': '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>''',
    'ppt/_rels/presentation.xml.rels': RELS.format(relationships=rel('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide', 'slides/slide1.xml')),
    'ppt/slides/slide1.xml': '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>''',
})

# ONLYOFFICE intentionally rejects the deliberately tiny packages above. Rewrite
# each one once into a complete OOXML document before the E2E uploads it.
converted = out / '.converted'
converted.mkdir(exist_ok=True)
for name in ('fixture.docx', 'fixture.xlsx', 'fixture.pptx'):
    run(['soffice', '--headless', '--convert-to', name.rsplit('.', 1)[1], '--outdir', str(converted), str(out / name)], check=True)
    copy2(converted / name, out / name)

# Author a valid PDF test input from the same standards-complete DOCX fixture.
run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', str(out), str(out / 'fixture.docx')], check=True)
