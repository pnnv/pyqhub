// Builds the course catalog from the NITK UG curriculum PDF.
//
//   pdftotext -layout UG_Curriculum_2025_v4.pdf curriculum.txt
//   node server/tools/parse-curriculum.js curriculum.txt > server/curriculum-2025.json
//
// Each programme's course lists say which courses it has and in which category; its
// "Suggested Plan of Study" grid gives the semester. Names come from the course lists, and
// the course-contents headings later in the document complete names that wrap in the lists.
import fs from 'node:fs';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage: node server/tools/parse-curriculum.js <pdftotext -layout output>');
  process.exit(1);
}
const lines = fs.readFileSync(file, 'utf8').split('\n');

// Programme names as printed in "Suggested Plan of Study for B.Tech. in …", mapped to site codes.
const PROGRAMMES = {
  'Chemical Engineering': 'CH',
  'Civil Engineering': 'CV',
  'Computer Science and Engineering': 'CS',
  'Electrical and Electronics Engineering': 'EE',
  'Electronics and Communication Engineering': 'EC',
  'Information Technology': 'IT',
  'Artificial Intelligence': 'AI',
  'Computational and Data Science': 'CDS',
  'Mechanical Engineering': 'ME',
  'Metallurgical and Materials Engineering': 'MT',
  'Mining Engineering': 'MN',
};

// Course-list headings. Courses under the "skip" ones never get mid/end-sem papers here:
// projects, honours (postgraduate) courses and minor/focus-area variants.
const CATEGORY_RULES = [
  [/\(BSC\)/, 'BSC'],
  [/\(ESC\)/, 'ESC'],
  [/\(HSC\)/, 'HSC'],
  [/\(PC\)/, 'PC'],
  [/\(PSE\)|Elective Courses/, 'PSE'],
  [/\(MP\)/, 'skip'],
  [/\(MLC\)/, 'MLC'],
  [/\(Hn\)|Hono(u)?rs? Courses|Honor Courses/, 'skip'],
  [/\(Mn\)|Minor Courses|Interdisciplinary/, 'skip'],
  [/Focus Area/, 'skip'],
];

const CODE = /\b([A-Z]{2})\s?(\d{3})([A-Z]?)\b/;
const LTP = /\(\s*(\d+)\s*-\s*(\d+)\s*-\s*(\d+)\s*\)\s*(\d+)/;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
let category = null; // the course-list heading currently being read
const isPageBreak = (l) => /NATIONAL INSTITUTE OF TECHNOLOGY KARNATAKA|^\s*-{20,}\s*$/.test(l);

// ---------- course-contents headings: "CS201   DESIGN OF DIGITAL SYSTEMS   (3-1-0)4" ----------

const contentsStart = lines.findIndex((l, i) => i > 4600 && /Department of Chemical Engineering/.test(l));
const headings = new Map();
for (const line of lines.slice(contentsStart)) {
  const m = line.match(/^\s*([A-Z]{2}\s?\d{3}[A-Z]?)(?:\s*\/\s*[A-Z]{2}\s?\d{3}[A-Z]?)*\s+(.+?)\s+\(\s*\d+\s*-\s*\d+\s*-\s*\d+\s*\)\s*\d+\s*$/);
  if (!m) continue;
  const code = m[1].replace(/\s/g, '');
  const title = m[2].replace(/\s+/g, ' ').trim();
  if (/[a-z]/.test(title) || title.length < 3) continue; // headings are in capitals
  if (!headings.has(code)) headings.set(code, title);
}

// ---------- programme blocks ----------

const planStarts = lines
  .map((l, i) => [l.match(/Suggested Plan of Study for B\.Tech\.? in ([A-Za-z ]+?)\s*:?\s*$/), i])
  .filter(([m]) => m)
  .map(([m, i]) => ({ name: m[1].trim(), line: i }));

const programmes = [];
for (const plan of planStarts) {
  const code = PROGRAMMES[plan.name];
  if (!code) throw new Error(`Unknown programme "${plan.name}"`);

  // Course lists sit between the department/programme heading and the plan grid. (CSE has a
  // department heading but no "Bachelor of Technology in" line.)
  let start = plan.line;
  while (start > 0 && !/Bachelor of Technology in|^\s*Department of .*\([A-Z]{2}\)/.test(lines[start])) start--;
  const listLines = lines.slice(start + 1, plan.line);
  const end = lines.findIndex((l, i) => i > plan.line && /Requirements for B\.Tech/.test(l));
  const gridLines = lines.slice(plan.line + 1, end);
  programmes.push({ code, name: plan.name, ...readLists(listLines), semesters: readPlan(gridLines) });
}

// Splits a two-column course list into its left and right columns, page by page, and reads
// them in order, tracking the category heading each column is under.
function readLists(block) {
  category = null;
  const pages = [[]];
  for (const line of block) {
    if (isPageBreak(line)) pages.push([]);
    else pages.at(-1).push(line);
  }
  const courses = [];
  for (const page of pages) {
    // The right column starts where the right-hand course codes start.
    const rightStarts = page
      .flatMap((l) => [...l.matchAll(/(?<=\s)[A-Z]{2}\s?\d{3}[A-Z]?\b/g)].map((m) => m.index).filter((i) => i > 45))
      .sort((a, b) => a - b);
    const split = rightStarts.length ? rightStarts[Math.floor(rightStarts.length * 0.1)] - 1 : 999;
    const left = page.map((l) => l.slice(0, split));
    const right = page.map((l) => l.slice(split));
    for (const column of [left, right]) readColumn(column, courses);
  }
  return { courses };
}

function readColumn(column, courses) {
  for (let i = 0; i < column.length; i++) {
    const line = column[i];
    const rule = CATEGORY_RULES.find(([re]) => re.test(line));
    if (rule) {
      category = rule[1];
      continue;
    }
    const m = line.match(new RegExp(`^\\s*${CODE.source}\\s*(.*)$`));
    if (!m || !category) continue;
    const [, dept, num, suffix, rest] = m;
    let ltp = rest.match(LTP);
    let name = (ltp ? rest.slice(0, ltp.index) : rest).trim();
    // "EC100 Elements of Electronics & Communication / Engineering (2-0-0)2": L-T-P on the next line.
    const next = column[i + 1] ?? '';
    if (!ltp && !CODE.test(next) && LTP.test(next)) {
      ltp = next.match(LTP);
      name = `${name} ${next.slice(0, ltp.index).trim()}`.trim();
    } else if (!name && next.trim() && !CODE.test(next)) {
      // "CV492   (3-0-0)3" with the name printed on the line below
      name = next.trim();
    }
    courses.push({
      code: `${dept}${num}${suffix}`,
      name: name.replace(/\s+/g, ' '),
      ltp: ltp ? `${ltp[1]}-${ltp[2]}-${ltp[3]}` : null,
      credits: ltp ? Number(ltp[4]) : null,
      category,
      minor: suffix === 'M',
    });
  }
}

// Reads the semester grid: each code is assigned to the nearest semester column.
function readPlan(grid) {
  const header = grid.find((l) => /\bVIII\b/.test(l) && /\bIII\b/.test(l));
  if (!header) throw new Error('Plan grid header not found');
  // Roman numerals overlap as substrings ("I" in "II"), so find each one after the previous.
  const centers = [];
  let from = 0;
  for (const [i, r] of ROMAN.entries()) {
    const re = new RegExp(`(?<![A-Z])${r}(?![A-Z])`, 'g');
    re.lastIndex = from;
    const m = re.exec(header);
    centers[i] = m.index + r.length / 2;
    from = m.index + r.length;
  }
  const semesters = {};
  for (const line of grid.slice(grid.indexOf(header) + 1)) {
    for (const m of line.matchAll(/\b([A-Z]{2})\s?(\d{3}[A-Z]?)\*?/g)) {
      const mid = m.index + m[0].length / 2;
      const sem = centers.reduce((best, c, i) => (Math.abs(c - mid) < Math.abs(centers[best] - mid) ? i : best), 0) + 1;
      const code = m[1] + m[2];
      semesters[code] ??= sem; // a course split over VII and VIII starts in VII
    }
  }
  return semesters;
}

// ---------- names ----------

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', 'via']);
const ACRONYMS = new Set(['AI', 'ML', 'IOT', 'VLSI', 'CMOS', 'RF', 'DSP', 'HVDC', 'AC', 'DC', 'GIS', 'CAD', 'CAM', 'CNC', 'MEMS', 'IC', 'FACTS', 'ARM', 'GPU', 'CPS', 'CFD', 'FEM', 'NLP', 'MOSFET', 'PLC', 'SCADA', 'II', 'III', 'IV', 'I', 'VI', 'VII', 'VIII', '3D', 'UAV', 'ERP', 'DBMS', 'OS', 'UX', 'XR', 'AR', 'VR', 'GNSS', 'GPS', 'EV', 'EVS', 'PV', 'RCC', 'PSC', 'BIM', 'LTE', '5G', 'MIMO', 'OFDM', 'SOC', 'FPGA', 'ASIC']);
function titleCase(caps) {
  return caps
    .toLowerCase()
    .split(' ')
    .map((word, i) =>
      word
        .split('-')
        .map((part) => {
          if (ACRONYMS.has(part.toUpperCase().replace(/[^A-Z0-9]/g, ''))) return part.toUpperCase().replace('IOT', 'IoT');
          if (i > 0 && SMALL.has(part)) return part;
          return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join('-'),
    )
    .join(' ');
}

const norm = (s) =>
  s
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\bENGG\b\.?/g, 'ENGINEERING')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

const truncated = (name) => !name || /\b(and|of|to|in|for|&|the|with|on)$/i.test(name) || name.length < 3;

function pickName(code, listed) {
  listed = listed.replace(/\bEngg\.?/g, 'Engineering');
  const heading = headings.get(code);
  if (!heading) return listed;
  if (!listed) return titleCase(heading);
  if (norm(heading) === norm(listed)) return listed;
  const words = heading.split(' ');
  // The list cut the name short: keep its casing, complete it from the heading.
  if (norm(heading).startsWith(`${norm(listed)} `)) {
    const have = norm(listed).split(' ').length;
    return `${listed} ${titleCase(words.slice(have).join(' '))}`;
  }
  if (truncated(listed) || /Engg\./.test(listed)) return titleCase(heading);
  return listed;
}

// ---------- output ----------

const subjects = new Map();
const offerings = [];
const skipped = { lab: 0, category: 0, minor: 0 };
for (const p of programmes) {
  const seen = new Set();
  for (const c of p.courses) {
    if (c.minor) { skipped.minor++; continue; }
    if (c.category === 'skip') { skipped.category++; continue; }
    const lectures = c.ltp ? Number(c.ltp.split('-')[0]) : 0;
    if (!lectures) { skipped.lab++; continue; } // labs, projects, seminars, training
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    const name = pickName(c.code, c.name);
    const existing = subjects.get(c.code);
    if (!existing || existing.name.length < name.length) subjects.set(c.code, { code: c.code, name, ltp: c.ltp, credits: c.credits });
    const semester = p.semesters[c.code] ?? null;
    offerings.push({ programme: p.code, code: c.code, semester: c.category === 'PSE' ? null : semester, category: c.category });
  }
}

const out = {
  source: 'NITK UG Curriculum 2025 (v4)',
  programmes: programmes.map((p) => ({ code: p.code, name: p.name })),
  subjects: [...subjects.values()].sort((a, b) => a.code.localeCompare(b.code)),
  offerings,
};
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
console.error(
  `${out.programmes.length} programmes, ${out.subjects.length} courses, ${offerings.length} offerings ` +
    `(${offerings.filter((o) => o.semester).length} with a semester); skipped ${skipped.lab} labs/projects, ` +
    `${skipped.category} honours/project/minor-list entries, ${skipped.minor} minor variants`,
);
