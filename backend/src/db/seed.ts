import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb, initSchema, resetDb } from './connection.js';
import { config } from '../config.js';
import { QRService } from '../services/qrService.js';

export function assertDemoSeedingAllowed(nodeEnv = config.nodeEnv): void {
  if (nodeEnv === 'production') {
    throw new Error('Demo seeding and database reset are disabled in production.');
  }
}

export async function runSeed(reset = false, nodeEnv = config.nodeEnv) {
  assertDemoSeedingAllowed(nodeEnv);
  if (reset) {
    resetDb();
  }
  const db = getDb();
  initSchema(db);

  // 1. Admin User
  const adminId = 'admin-root-01';
  const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(config.adminUsername);
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(config.adminPassword, 10);
    db.prepare(`
      INSERT INTO admin_users (id, username, password_hash, full_name, email, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(adminId, config.adminUsername, passwordHash, 'Hostel General Manager', 'manager@hostel-demo.local');
    console.log(`Admin user created: ${config.adminUsername}`);
  }

  // 2. Hostels (Male & Female)
  const hostels = [
    { id: 'hostel-male', code: 'MALE', name: 'Alpha Male Hall (DEMO)', desc: 'West Wing Accommodation for Men', cap: 50 },
    { id: 'hostel-female', code: 'FEMALE', name: 'Beta Female Hall (DEMO)', desc: 'East Wing Accommodation for Women', cap: 50 }
  ];

  for (const h of hostels) {
    db.prepare(`
      INSERT OR IGNORE INTO hostels (id, code, name, description, total_capacity, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(h.id, h.code, h.name, h.desc, h.cap);
  }

  // 3. Rooms (Single, Double, Triple)
  // Demo prices: Single = $1,200/yr, Double = $800/yr, Triple = $600/yr
  const roomDefs = [
    // Male Hostel
    { id: 'rm-m-101', hostelId: 'hostel-male', number: 'M-101', cap: 1, price: 1200 },
    { id: 'rm-m-102', hostelId: 'hostel-male', number: 'M-102', cap: 1, price: 1200 },
    { id: 'rm-m-103', hostelId: 'hostel-male', number: 'M-103', cap: 1, price: 1200 },
    { id: 'rm-m-104', hostelId: 'hostel-male', number: 'M-104', cap: 1, price: 1200 },
    { id: 'rm-m-105', hostelId: 'hostel-male', number: 'M-105', cap: 1, price: 1200 },
    { id: 'rm-m-201', hostelId: 'hostel-male', number: 'M-201', cap: 2, price: 800 },
    { id: 'rm-m-202', hostelId: 'hostel-male', number: 'M-202', cap: 2, price: 800 },
    { id: 'rm-m-203', hostelId: 'hostel-male', number: 'M-203', cap: 2, price: 800 },
    { id: 'rm-m-301', hostelId: 'hostel-male', number: 'M-301', cap: 3, price: 600 },
    { id: 'rm-m-302', hostelId: 'hostel-male', number: 'M-302', cap: 3, price: 600 },
    // Female Hostel
    { id: 'rm-f-101', hostelId: 'hostel-female', number: 'F-101', cap: 1, price: 1200 },
    { id: 'rm-f-102', hostelId: 'hostel-female', number: 'F-102', cap: 1, price: 1200 },
    { id: 'rm-f-103', hostelId: 'hostel-female', number: 'F-103', cap: 1, price: 1200 },
    { id: 'rm-f-104', hostelId: 'hostel-female', number: 'F-104', cap: 1, price: 1200 },
    { id: 'rm-f-105', hostelId: 'hostel-female', number: 'F-105', cap: 1, price: 1200 },
    { id: 'rm-f-201', hostelId: 'hostel-female', number: 'F-201', cap: 2, price: 800 },
    { id: 'rm-f-202', hostelId: 'hostel-female', number: 'F-202', cap: 2, price: 800 },
    { id: 'rm-f-203', hostelId: 'hostel-female', number: 'F-203', cap: 2, price: 800 },
    { id: 'rm-f-301', hostelId: 'hostel-female', number: 'F-301', cap: 3, price: 600 },
    { id: 'rm-f-302', hostelId: 'hostel-female', number: 'F-302', cap: 3, price: 600 },
  ];

  for (const r of roomDefs) {
    db.prepare(`
      INSERT OR IGNORE INTO rooms (id, hostel_id, room_number, capacity, price_per_student, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'AVAILABLE', datetime('now'), datetime('now'))
    `).run(r.id, r.hostelId, r.number, r.cap, r.price);
  }

  // Helper for students
  const insertStudent = (s: {
    id: string;
    fullName: string;
    phone: string;
    gender: 'MALE' | 'FEMALE';
    dept: string;
    level: string;
    prefCap: number;
    mode: 'KNOWN' | 'RANDOM';
    consentRandom: number;
  }) => {
    db.prepare(`
      INSERT OR IGNORE INTO students (id, full_name, phone_number, gender, department, academic_level, preferred_occupancy, roommate_mode, consent_random_matching, photo_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      s.id,
      s.fullName,
      s.phone,
      s.gender,
      s.dept,
      s.level,
      s.prefCap,
      s.mode,
      s.consentRandom,
      `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(s.fullName)}`
    );
  };

  // 4. Demo Students

  // Student 1: John Doe (Male, Single, Allocated, Active QR)
  insertStudent({
    id: 'stu-demo-01',
    fullName: 'John Doe (DEMO)',
    phone: '+15551001001',
    gender: 'MALE',
    dept: 'Computer Science',
    level: '300 Level',
    prefCap: 1,
    mode: 'KNOWN',
    consentRandom: 0
  });

  // Booking Group 1: John Doe
  const grp1Id = 'grp-demo-01';
  db.prepare(`
    INSERT OR IGNORE INTO booking_groups (id, group_code, hostel_id, target_capacity, status, created_by_student_id, eligible_at, held_room_id, created_at, updated_at)
    VALUES (?, 'GRP-JOHNDOE', 'hostel-male', 1, 'ALLOCATED', 'stu-demo-01', datetime('now', '-30 days'), 'rm-m-101', datetime('now', '-30 days'), datetime('now'))
  `).run(grp1Id);

  db.prepare(`
    INSERT OR IGNORE INTO booking_group_members (id, group_id, student_id, role, is_matched_from_queue, joined_at)
    VALUES ('bgm-demo-01', ?, 'stu-demo-01', 'LEADER', 0, datetime('now', '-30 days'))
  `).run(grp1Id);

  // Payment 1: Verified
  db.prepare(`
    INSERT OR IGNORE INTO payments (id, student_id, booking_group_id, amount, currency, status, reference_code, verified_by_admin_id, verified_at, notes, created_at, updated_at)
    VALUES ('pay-demo-01', 'stu-demo-01', ?, 1200, 'USD', 'VERIFIED', 'PAY-REF-JD-01', 'admin-root-01', datetime('now', '-29 days'), 'Manual bank receipt confirmed (DEMO)', datetime('now', '-30 days'), datetime('now', '-29 days'))
  `).run(grp1Id);

  // Allocation 1: Finalized M-101 (Accommodation 2026-01-15 to 2027-01-15)
  const alloc1Id = 'alloc-demo-01';
  db.prepare(`
    INSERT OR IGNORE INTO room_allocations (id, room_id, student_id, booking_group_id, status, allocated_by_admin_id, accommodation_start_date, accommodation_end_date, created_at, updated_at)
    VALUES (?, 'rm-m-101', 'stu-demo-01', ?, 'FINALIZED', 'admin-root-01', '2026-01-15', '2027-01-15', datetime('now', '-28 days'), datetime('now'))
  `).run(alloc1Id, grp1Id);

  // Generate real verifiable QR for John Doe
  const { tokenHash: qrHash1 } = QRService.generateToken();
  const qrImage1 = null; // Legacy history is retained without persisting a raw-token QR image.
  db.prepare(`
    INSERT OR IGNORE INTO qr_credentials (id, student_id, room_allocation_id, token_hash, status, issued_at, last_issued_at, qr_image_data, created_at, updated_at)
    VALUES ('qr-demo-01', 'stu-demo-01', ?, ?, 'ACTIVE', datetime('now', '-28 days'), datetime('now', '-28 days'), ?, datetime('now', '-28 days'), datetime('now'))
  `).run(alloc1Id, qrHash1, qrImage1);

  // Update room status
  db.prepare('UPDATE rooms SET status = \'OCCUPIED\' WHERE id = \'rm-m-101\'').run();

  // Group 2: Female Double Room Pair (Sarah Connor & Emily Blunt)
  insertStudent({
    id: 'stu-demo-02',
    fullName: 'Sarah Connor (DEMO)',
    phone: '+15552002001',
    gender: 'FEMALE',
    dept: 'Electrical Engineering',
    level: '400 Level',
    prefCap: 2,
    mode: 'KNOWN',
    consentRandom: 0
  });
  insertStudent({
    id: 'stu-demo-03',
    fullName: 'Emily Blunt (DEMO)',
    phone: '+15552002002',
    gender: 'FEMALE',
    dept: 'Mechanical Engineering',
    level: '400 Level',
    prefCap: 2,
    mode: 'KNOWN',
    consentRandom: 0
  });

  const grp2Id = 'grp-demo-02';
  db.prepare(`
    INSERT OR IGNORE INTO booking_groups (id, group_code, hostel_id, target_capacity, status, created_by_student_id, eligible_at, held_room_id, created_at, updated_at)
    VALUES (?, 'GRP-FEMALE-PAIR', 'hostel-female', 2, 'ALLOCATED', 'stu-demo-02', datetime('now', '-20 days'), 'rm-f-201', datetime('now', '-20 days'), datetime('now'))
  `).run(grp2Id);

  db.prepare(`
    INSERT OR IGNORE INTO booking_group_members (id, group_id, student_id, role, is_matched_from_queue, joined_at)
    VALUES ('bgm-demo-02', ?, 'stu-demo-02', 'LEADER', 0, datetime('now', '-20 days')),
           ('bgm-demo-03', ?, 'stu-demo-03', 'MEMBER', 0, datetime('now', '-19 days'))
  `).run(grp2Id, grp2Id);

  // Both payments verified ($800 each)
  db.prepare(`
    INSERT OR IGNORE INTO payments (id, student_id, booking_group_id, amount, currency, status, reference_code, verified_by_admin_id, verified_at, notes, created_at, updated_at)
    VALUES ('pay-demo-02', 'stu-demo-02', ?, 800, 'USD', 'VERIFIED', 'PAY-REF-SC-02', 'admin-root-01', datetime('now', '-18 days'), 'Card payment receipt (DEMO)', datetime('now', '-19 days'), datetime('now', '-18 days')),
           ('pay-demo-03', 'stu-demo-03', ?, 800, 'USD', 'VERIFIED', 'PAY-REF-EB-03', 'admin-root-01', datetime('now', '-18 days'), 'Transfer verified (DEMO)', datetime('now', '-19 days'), datetime('now', '-18 days'))
  `).run(grp2Id, grp2Id);

  // Finalized in F-201 (Start 2026-03-01 to 2027-03-01)
  const alloc2Id = 'alloc-demo-02';
  const alloc3Id = 'alloc-demo-03';
  db.prepare(`
    INSERT OR IGNORE INTO room_allocations (id, room_id, student_id, booking_group_id, status, allocated_by_admin_id, accommodation_start_date, accommodation_end_date, created_at, updated_at)
    VALUES (?, 'rm-f-201', 'stu-demo-02', ?, 'FINALIZED', 'admin-root-01', '2026-03-01', '2027-03-01', datetime('now', '-17 days'), datetime('now')),
           (?, 'rm-f-201', 'stu-demo-03', ?, 'FINALIZED', 'admin-root-01', '2026-03-01', '2027-03-01', datetime('now', '-17 days'), datetime('now'))
  `).run(alloc2Id, grp2Id, alloc3Id, grp2Id);

  // QR Credentials for both
  const { tokenHash: qrHash2 } = QRService.generateToken();
  const { tokenHash: qrHash3 } = QRService.generateToken();
  const qrImage2 = null;
  const qrImage3 = null;

  db.prepare(`
    INSERT OR IGNORE INTO qr_credentials (id, student_id, room_allocation_id, token_hash, status, issued_at, last_issued_at, qr_image_data, created_at, updated_at)
    VALUES ('qr-demo-02', 'stu-demo-02', ?, ?, 'ACTIVE', datetime('now', '-17 days'), datetime('now', '-17 days'), ?, datetime('now', '-17 days'), datetime('now')),
           ('qr-demo-03', 'stu-demo-03', ?, ?, 'ACTIVE', datetime('now', '-17 days'), datetime('now', '-17 days'), ?, datetime('now', '-17 days'), datetime('now'))
  `).run(alloc2Id, qrHash2, qrImage2, alloc3Id, qrHash3, qrImage3);

  db.prepare('UPDATE rooms SET status = \'OCCUPIED\' WHERE id = \'rm-f-201\'').run();

  // Group 3: Known pair (Alex Hunter & Marcus Vance) requesting Triple,
  // matched with an independently opted-in 3rd student (Lucas Gray) from Random Matching Queue!
  insertStudent({
    id: 'stu-demo-04',
    fullName: 'Alex Hunter (DEMO)',
    phone: '+15553003001',
    gender: 'MALE',
    dept: 'Economics',
    level: '200 Level',
    prefCap: 3,
    mode: 'KNOWN',
    consentRandom: 1 // Consented to 3rd member matching
  });
  insertStudent({
    id: 'stu-demo-05',
    fullName: 'Marcus Vance (DEMO)',
    phone: '+15553003002',
    gender: 'MALE',
    dept: 'Finance',
    level: '200 Level',
    prefCap: 3,
    mode: 'KNOWN',
    consentRandom: 1
  });
  insertStudent({
    id: 'stu-demo-06',
    fullName: 'Lucas Gray (DEMO)',
    phone: '+15553003003',
    gender: 'MALE',
    dept: 'Architecture',
    level: '200 Level',
    prefCap: 3,
    mode: 'RANDOM',
    consentRandom: 1 // independently opted into random matching!
  });

  const grp3Id = 'grp-demo-03';
  db.prepare(`
    INSERT OR IGNORE INTO booking_groups (id, group_code, hostel_id, target_capacity, status, created_by_student_id, eligible_at, held_room_id, created_at, updated_at)
    VALUES (?, 'GRP-TRIPLE-MATCH', 'hostel-male', 3, 'READY_FOR_ALLOCATION', 'stu-demo-04', datetime('now', '-5 days'), 'rm-m-301', datetime('now', '-6 days'), datetime('now'))
  `).run(grp3Id);

  db.prepare(`
    INSERT OR IGNORE INTO booking_group_members (id, group_id, student_id, role, is_matched_from_queue, joined_at)
    VALUES ('bgm-demo-04', ?, 'stu-demo-04', 'LEADER', 0, datetime('now', '-6 days')),
           ('bgm-demo-05', ?, 'stu-demo-05', 'MEMBER', 0, datetime('now', '-6 days')),
           ('bgm-demo-06', ?, 'stu-demo-06', 'MEMBER', 1, datetime('now', '-5 days'))
  `).run(grp3Id, grp3Id, grp3Id);

  // Payments: Alex verified, Marcus verified, Lucas pending
  db.prepare(`
    INSERT OR IGNORE INTO payments (id, student_id, booking_group_id, amount, currency, status, reference_code, verified_by_admin_id, verified_at, notes, created_at, updated_at)
    VALUES ('pay-demo-04', 'stu-demo-04', ?, 600, 'USD', 'VERIFIED', 'PAY-REF-AH-04', 'admin-root-01', datetime('now', '-4 days'), 'Bank transfer confirmed (DEMO)', datetime('now', '-5 days'), datetime('now', '-4 days')),
           ('pay-demo-05', 'stu-demo-05', ?, 600, 'USD', 'VERIFIED', 'PAY-REF-MV-05', 'admin-root-01', datetime('now', '-4 days'), 'Online deposit verified (DEMO)', datetime('now', '-5 days'), datetime('now', '-4 days')),
           ('pay-demo-06', 'stu-demo-06', ?, 600, 'USD', 'PENDING', 'PAY-REF-LG-06', NULL, NULL, 'Awaiting student proof submission (DEMO)', datetime('now', '-5 days'), datetime('now', '-5 days'))
  `).run(grp3Id, grp3Id, grp3Id);

  // Room held on M-301, allocation in HOLD status (cannot finalize until Lucas's payment is verified!)
  db.prepare(`
    INSERT OR IGNORE INTO room_allocations (id, room_id, student_id, booking_group_id, status, allocated_by_admin_id, accommodation_start_date, accommodation_end_date, created_at, updated_at)
    VALUES ('alloc-demo-04', 'rm-m-301', 'stu-demo-04', ?, 'HOLD', NULL, '2026-12-01', '2027-12-01', datetime('now', '-3 days'), datetime('now')),
           ('alloc-demo-05', 'rm-m-301', 'stu-demo-05', ?, 'HOLD', NULL, '2026-12-01', '2027-12-01', datetime('now', '-3 days'), datetime('now')),
           ('alloc-demo-06', 'rm-m-301', 'stu-demo-06', ?, 'HOLD', NULL, '2026-12-01', '2027-12-01', datetime('now', '-3 days'), datetime('now'))
  `).run(grp3Id, grp3Id, grp3Id);

  // Group 4: Chloe Bennett (Female, Double, Waiting for another roommate member)
  insertStudent({
    id: 'stu-demo-07',
    fullName: 'Chloe Bennett (DEMO)',
    phone: '+15554004001',
    gender: 'FEMALE',
    dept: 'Biochemistry',
    level: '100 Level',
    prefCap: 2,
    mode: 'KNOWN',
    consentRandom: 0
  });

  const grp4Id = 'grp-demo-04';
  db.prepare(`
    INSERT OR IGNORE INTO booking_groups (id, group_code, hostel_id, target_capacity, status, created_by_student_id, eligible_at, held_room_id, created_at, updated_at)
    VALUES (?, 'GRP-CHLOE-WAIT', 'hostel-female', 2, 'FORMING', 'stu-demo-07', NULL, NULL, datetime('now', '-2 days'), datetime('now'))
  `).run(grp4Id);

  db.prepare(`
    INSERT OR IGNORE INTO booking_group_members (id, group_id, student_id, role, is_matched_from_queue, joined_at)
    VALUES ('bgm-demo-07', ?, 'stu-demo-07', 'LEADER', 0, datetime('now', '-2 days'))
  `).run(grp4Id);

  db.prepare(`
    INSERT OR IGNORE INTO payments (id, student_id, booking_group_id, amount, currency, status, reference_code, verified_by_admin_id, verified_at, notes, created_at, updated_at)
    VALUES ('pay-demo-07', 'stu-demo-07', ?, 800, 'USD', 'PENDING', 'PAY-REF-CB-07', NULL, NULL, 'Pending payment upload (DEMO)', datetime('now', '-2 days'), datetime('now', '-2 days'))
  `).run(grp4Id);

  // 5. Students with different accommodation dates and expiries for RENEWAL TESTING:
  // Relative to current local date: 2026-11-03
  // Expiry 1: Liam Neeson -> expires 2026-11-09 (6 days remaining -> CRITICAL_7_DAYS)
  insertStudent({
    id: 'stu-demo-08',
    fullName: 'Liam Neeson (DEMO)',
    phone: '+15555005001',
    gender: 'MALE',
    dept: 'Law',
    level: '500 Level',
    prefCap: 1,
    mode: 'KNOWN',
    consentRandom: 0
  });
  const grp5Id = 'grp-demo-05';
  db.prepare(`
    INSERT OR IGNORE INTO booking_groups (id, group_code, hostel_id, target_capacity, status, created_by_student_id, eligible_at, held_room_id, created_at, updated_at)
    VALUES (?, 'GRP-LIAM-EXP', 'hostel-male', 1, 'ALLOCATED', 'stu-demo-08', '2025-11-09', 'rm-m-102', '2025-11-09', datetime('now'))
  `).run(grp5Id);
  db.prepare(`
    INSERT OR IGNORE INTO booking_group_members (id, group_id, student_id, role, is_matched_from_queue, joined_at)
    VALUES ('bgm-demo-08', ?, 'stu-demo-08', 'LEADER', 0, '2025-11-09')
  `).run(grp5Id);
  db.prepare(`
    INSERT OR IGNORE INTO payments (id, student_id, booking_group_id, amount, currency, status, reference_code, verified_by_admin_id, verified_at, notes, created_at, updated_at)
    VALUES ('pay-demo-08', 'stu-demo-08', ?, 1200, 'USD', 'VERIFIED', 'PAY-REF-LN-08', 'admin-root-01', '2025-11-09', 'Annual fee verified (DEMO)', '2025-11-09', '2025-11-09')
  `).run(grp5Id);
  const alloc8Id = 'alloc-demo-08';
  db.prepare(`
    INSERT OR IGNORE INTO room_allocations (id, room_id, student_id, booking_group_id, status, allocated_by_admin_id, accommodation_start_date, accommodation_end_date, created_at, updated_at)
    VALUES (?, 'rm-m-102', 'stu-demo-08', ?, 'FINALIZED', 'admin-root-01', '2025-11-09', '2026-11-09', '2025-11-09', datetime('now'))
  `).run(alloc8Id, grp5Id);
  const { tokenHash: qrHash8 } = QRService.generateToken();
  const qrImage8 = null;
  db.prepare(`
    INSERT OR IGNORE INTO qr_credentials (id, student_id, room_allocation_id, token_hash, status, issued_at, last_issued_at, qr_image_data, created_at, updated_at)
    VALUES ('qr-demo-08', 'stu-demo-08', ?, ?, 'ACTIVE', '2025-11-09', '2025-11-09', ?, '2025-11-09', datetime('now'))
  `).run(alloc8Id, qrHash8, qrImage8);
  db.prepare('UPDATE rooms SET status = \'OCCUPIED\' WHERE id = \'rm-m-102\'').run();

  // Expiry 2: Clara Oswald -> expires 2026-11-15 (12 days remaining -> WARNING_14_DAYS)
  insertStudent({
    id: 'stu-demo-09',
    fullName: 'Clara Oswald (DEMO)',
    phone: '+15555005002',
    gender: 'FEMALE',
    dept: 'Literature',
    level: '300 Level',
    prefCap: 1,
    mode: 'KNOWN',
    consentRandom: 0
  });
  const grp6Id = 'grp-demo-06';
  db.prepare(`
    INSERT OR IGNORE INTO booking_groups (id, group_code, hostel_id, target_capacity, status, created_by_student_id, eligible_at, held_room_id, created_at, updated_at)
    VALUES (?, 'GRP-CLARA-EXP', 'hostel-female', 1, 'ALLOCATED', 'stu-demo-09', '2025-11-15', 'rm-f-101', '2025-11-15', datetime('now'))
  `).run(grp6Id);
  db.prepare(`
    INSERT OR IGNORE INTO booking_group_members (id, group_id, student_id, role, is_matched_from_queue, joined_at)
    VALUES ('bgm-demo-09', ?, 'stu-demo-09', 'LEADER', 0, '2025-11-15')
  `).run(grp6Id);
  db.prepare(`
    INSERT OR IGNORE INTO payments (id, student_id, booking_group_id, amount, currency, status, reference_code, verified_by_admin_id, verified_at, notes, created_at, updated_at)
    VALUES ('pay-demo-09', 'stu-demo-09', ?, 1200, 'USD', 'VERIFIED', 'PAY-REF-CO-09', 'admin-root-01', '2025-11-15', 'Full fee confirmed (DEMO)', '2025-11-15', '2025-11-15')
  `).run(grp6Id);
  const alloc9Id = 'alloc-demo-09';
  db.prepare(`
    INSERT OR IGNORE INTO room_allocations (id, room_id, student_id, booking_group_id, status, allocated_by_admin_id, accommodation_start_date, accommodation_end_date, created_at, updated_at)
    VALUES (?, 'rm-f-101', 'stu-demo-09', ?, 'FINALIZED', 'admin-root-01', '2025-11-15', '2026-11-15', '2025-11-15', datetime('now'))
  `).run(alloc9Id, grp6Id);
  const { tokenHash: qrHash9 } = QRService.generateToken();
  const qrImage9 = null;
  db.prepare(`
    INSERT OR IGNORE INTO qr_credentials (id, student_id, room_allocation_id, token_hash, status, issued_at, last_issued_at, qr_image_data, created_at, updated_at)
    VALUES ('qr-demo-09', 'stu-demo-09', ?, ?, 'ACTIVE', '2025-11-15', '2025-11-15', ?, '2025-11-15', datetime('now'))
  `).run(alloc9Id, qrHash9, qrImage9);
  db.prepare('UPDATE rooms SET status = \'OCCUPIED\' WHERE id = \'rm-f-101\'').run();

  // Expiry 3: David Tennant -> expires 2026-11-28 (25 days remaining -> NOTICE_30_DAYS)
  insertStudent({
    id: 'stu-demo-10',
    fullName: 'David Tennant (DEMO)',
    phone: '+15555005003',
    gender: 'MALE',
    dept: 'Physics',
    level: '400 Level',
    prefCap: 2,
    mode: 'KNOWN',
    consentRandom: 0
  });
  const grp7Id = 'grp-demo-07';
  db.prepare(`
    INSERT OR IGNORE INTO booking_groups (id, group_code, hostel_id, target_capacity, status, created_by_student_id, eligible_at, held_room_id, created_at, updated_at)
    VALUES (?, 'GRP-DAVID-EXP', 'hostel-male', 2, 'ALLOCATED', 'stu-demo-10', '2025-11-28', 'rm-m-201', '2025-11-28', datetime('now'))
  `).run(grp7Id);
  db.prepare(`
    INSERT OR IGNORE INTO booking_group_members (id, group_id, student_id, role, is_matched_from_queue, joined_at)
    VALUES ('bgm-demo-10', ?, 'stu-demo-10', 'LEADER', 0, '2025-11-28')
  `).run(grp7Id);
  db.prepare(`
    INSERT OR IGNORE INTO payments (id, student_id, booking_group_id, amount, currency, status, reference_code, verified_by_admin_id, verified_at, notes, created_at, updated_at)
    VALUES ('pay-demo-10', 'stu-demo-10', ?, 800, 'USD', 'VERIFIED', 'PAY-REF-DT-10', 'admin-root-01', '2025-11-28', 'Paid (DEMO)', '2025-11-28', '2025-11-28')
  `).run(grp7Id);
  const alloc10Id = 'alloc-demo-10';
  db.prepare(`
    INSERT OR IGNORE INTO room_allocations (id, room_id, student_id, booking_group_id, status, allocated_by_admin_id, accommodation_start_date, accommodation_end_date, created_at, updated_at)
    VALUES (?, 'rm-m-201', 'stu-demo-10', ?, 'FINALIZED', 'admin-root-01', '2025-11-28', '2026-11-28', '2025-11-28', datetime('now'))
  `).run(alloc10Id, grp7Id);
  const { tokenHash: qrHash10 } = QRService.generateToken();
  const qrImage10 = null;
  db.prepare(`
    INSERT OR IGNORE INTO qr_credentials (id, student_id, room_allocation_id, token_hash, status, issued_at, last_issued_at, qr_image_data, created_at, updated_at)
    VALUES ('qr-demo-10', 'stu-demo-10', ?, ?, 'ACTIVE', '2025-11-28', '2025-11-28', ?, '2025-11-28', datetime('now'))
  `).run(alloc10Id, qrHash10, qrImage10);

  // Expiry 4: Peter Capaldi -> already EXPIRED & REVOKED example
  insertStudent({
    id: 'stu-demo-11',
    fullName: 'Peter Capaldi (DEMO)',
    phone: '+15555005004',
    gender: 'MALE',
    dept: 'Philosophy',
    level: 'Postgraduate',
    prefCap: 1,
    mode: 'KNOWN',
    consentRandom: 0
  });
  const grp8Id = 'grp-demo-08';
  db.prepare(`
    INSERT OR IGNORE INTO booking_groups (id, group_code, hostel_id, target_capacity, status, created_by_student_id, eligible_at, held_room_id, created_at, updated_at)
    VALUES (?, 'GRP-PETER-REV', 'hostel-male', 1, 'ALLOCATED', 'stu-demo-11', '2025-10-25', 'rm-m-103', '2025-10-25', datetime('now'))
  `).run(grp8Id);
  db.prepare(`
    INSERT OR IGNORE INTO booking_group_members (id, group_id, student_id, role, is_matched_from_queue, joined_at)
    VALUES ('bgm-demo-11', ?, 'stu-demo-11', 'LEADER', 0, '2025-10-25')
  `).run(grp8Id);
  db.prepare(`
    INSERT OR IGNORE INTO payments (id, student_id, booking_group_id, amount, currency, status, reference_code, verified_by_admin_id, verified_at, notes, created_at, updated_at)
    VALUES ('pay-demo-11', 'stu-demo-11', ?, 1200, 'USD', 'VERIFIED', 'PAY-REF-PC-11', 'admin-root-01', '2025-10-25', 'Paid (DEMO)', '2025-10-25', '2025-10-25')
  `).run(grp8Id);
  const alloc11Id = 'alloc-demo-11';
  db.prepare(`
    INSERT OR IGNORE INTO room_allocations (id, room_id, student_id, booking_group_id, status, allocated_by_admin_id, accommodation_start_date, accommodation_end_date, created_at, updated_at)
    VALUES (?, 'rm-m-103', 'stu-demo-11', ?, 'FINALIZED', 'admin-root-01', '2025-10-25', '2026-10-25', '2025-10-25', datetime('now'))
  `).run(alloc11Id, grp8Id);
  const { tokenHash: qrHash11 } = QRService.generateToken();
  const qrImage11 = null;
  db.prepare(`
    INSERT OR IGNORE INTO qr_credentials (id, student_id, room_allocation_id, token_hash, status, issued_at, revoked_at, revoke_reason, last_issued_at, qr_image_data, created_at, updated_at)
    VALUES ('qr-demo-11', 'stu-demo-11', ?, ?, 'REVOKED', '2025-10-25', datetime('now', '-5 days'), 'Disciplinary clearance hold (DEMO)', '2025-10-25', ?, '2025-10-25', datetime('now'))
  `).run(alloc11Id, qrHash11, qrImage11);

  // 6. Random Matching Queue
  // Female students waiting in queue: Maya Lin & Tara Strong
  insertStudent({
    id: 'stu-demo-12',
    fullName: 'Maya Lin (DEMO)',
    phone: '+15556006001',
    gender: 'FEMALE',
    dept: 'Fine Arts',
    level: '200 Level',
    prefCap: 2,
    mode: 'RANDOM',
    consentRandom: 1
  });
  insertStudent({
    id: 'stu-demo-13',
    fullName: 'Tara Strong (DEMO)',
    phone: '+15556006002',
    gender: 'FEMALE',
    dept: 'Theatre Arts',
    level: '300 Level',
    prefCap: 3,
    mode: 'RANDOM',
    consentRandom: 1
  });

  db.prepare(`
    INSERT OR IGNORE INTO matching_queue (id, student_id, hostel_id, target_capacity, status, queued_at)
    VALUES ('mq-demo-01', 'stu-demo-12', 'hostel-female', 2, 'WAITING', datetime('now', '-2 days')),
           ('mq-demo-02', 'stu-demo-13', 'hostel-female', 3, 'WAITING', datetime('now', '-1 day'))
  `).run();

  // 7. Initial Audit Log
  db.prepare(`
    INSERT OR IGNORE INTO audit_logs (id, admin_id, action, entity_type, entity_id, old_values, new_values, notes, created_at)
    VALUES ('audit-demo-01', 'admin-root-01', 'SEED_INITIALIZE', 'SYSTEM', 'hostel-system', NULL, '{"environment":"demonstration"}', 'Initial synthetic seed data populated successfully.', datetime('now'))
  `).run();

  console.log('Synthetic DEMO data seeding complete!');
  console.log('Legacy demonstration QR records were preserved without printing credential tokens.');
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  runSeed().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
