// Starting catalog of branches and courses. Admins can add more from the dashboard.
export const branches = [
  { code: 'CS', name: 'Computer Science and Engineering' },
  { code: 'IT', name: 'Information Technology' },
  { code: 'AI', name: 'Artificial Intelligence' },
  { code: 'EC', name: 'Electronics and Communication Engineering' },
  { code: 'EE', name: 'Electrical and Electronics Engineering' },
  { code: 'ME', name: 'Mechanical Engineering' },
  { code: 'CV', name: 'Civil Engineering' },
  { code: 'CH', name: 'Chemical Engineering' },
  { code: 'MT', name: 'Metallurgical and Materials Engineering' },
  { code: 'MN', name: 'Mining Engineering' },
];

// [code, name, year of study]
const firstYear = [
  ['MA110', 'Engineering Mathematics I', 1],
  ['MA111', 'Engineering Mathematics II', 1],
  ['PH110', 'Physics', 1],
  ['CY110', 'Chemistry', 1],
  ['CS110', 'Computer Programming', 1],
  ['EE110', 'Elements of Electrical Engineering', 1],
  ['ME110', 'Elements of Mechanical Engineering', 1],
];

const byBranch = {
  CS: [
    ['CS201', 'Data Structures and Algorithms', 2],
    ['CS202', 'Discrete Mathematics', 2],
    ['CS203', 'Digital Systems Design', 2],
    ['CS250', 'Design and Analysis of Algorithms', 2],
    ['CS251', 'Computer Organisation', 2],
    ['CS252', 'Theory of Computation', 2],
    ['CS301', 'Operating Systems', 3],
    ['CS302', 'Database Systems', 3],
    ['CS303', 'Computer Networks', 3],
    ['CS350', 'Compiler Design', 3],
    ['CS351', 'Software Engineering', 3],
    ['CS401', 'Distributed Systems', 4],
    ['CS402', 'Cryptography and Network Security', 4],
  ],
  IT: [
    ['IT201', 'Object Oriented Programming', 2],
    ['IT202', 'Data Structures', 2],
    ['IT250', 'Web Technologies', 2],
    ['IT301', 'Parallel Computing', 3],
    ['IT302', 'Information Retrieval', 3],
    ['IT350', 'Machine Learning', 3],
    ['IT401', 'Cloud Computing', 4],
  ],
  AI: [
    ['AI201', 'Probability and Statistics for AI', 2],
    ['AI250', 'Foundations of Machine Learning', 2],
    ['AI301', 'Deep Learning', 3],
    ['AI350', 'Natural Language Processing', 3],
  ],
  EC: [
    ['EC201', 'Network Analysis', 2],
    ['EC202', 'Electronic Circuits', 2],
    ['EC250', 'Signals and Systems', 2],
    ['EC301', 'Digital Signal Processing', 3],
    ['EC302', 'Analog Communication', 3],
    ['EC350', 'VLSI Design', 3],
    ['EC401', 'Wireless Communication', 4],
  ],
  EE: [
    ['EE201', 'Electric Circuits', 2],
    ['EE202', 'Electrical Machines I', 2],
    ['EE250', 'Control Systems', 2],
    ['EE301', 'Power Systems', 3],
    ['EE302', 'Power Electronics', 3],
  ],
  ME: [
    ['ME201', 'Engineering Thermodynamics', 2],
    ['ME202', 'Mechanics of Materials', 2],
    ['ME250', 'Fluid Mechanics', 2],
    ['ME301', 'Heat Transfer', 3],
    ['ME302', 'Design of Machine Elements', 3],
    ['ME401', 'Finite Element Methods', 4],
  ],
  CV: [
    ['CV201', 'Surveying', 2],
    ['CV202', 'Strength of Materials', 2],
    ['CV301', 'Structural Analysis', 3],
    ['CV302', 'Geotechnical Engineering', 3],
  ],
  CH: [
    ['CH201', 'Chemical Process Calculations', 2],
    ['CH250', 'Mass Transfer I', 2],
    ['CH301', 'Chemical Reaction Engineering', 3],
  ],
  MT: [
    ['MT201', 'Physical Metallurgy', 2],
    ['MT301', 'Mechanical Behaviour of Materials', 3],
  ],
  MN: [
    ['MN201', 'Mine Surveying', 2],
    ['MN301', 'Rock Mechanics', 3],
  ],
};

// First-year courses are common to every branch, so they carry no branch.
export const subjects = [
  ...firstYear.map(([code, name, year]) => ({ code, name, year, branch: null })),
  ...Object.entries(byBranch).flatMap(([branch, list]) =>
    list.map(([code, name, year]) => ({ code, name, year, branch })),
  ),
];
