import fs from "fs";
import path from "path";
import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { runSeed } from "../src/db/seed.js";
import { getDb } from "../src/db/connection.js";
import { config } from "../src/config.js";
import { StudentPhotoService } from "../src/services/studentPhotoService.js";
import { SimulatorProvider } from "../src/services/whatsapp/simulatorProvider.js";

const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01,
  0x11, 0x00, 0xff, 0xd9,
]);

describe("Student photograph capture and secure upload", () => {
  beforeEach(async () => {
    await runSeed(true);
    SimulatorProvider.clearHistory();
    fs.rmSync(config.photoStorageDir, { recursive: true, force: true });
  });
  afterEach(() =>
    fs.rmSync(config.photoStorageDir, { recursive: true, force: true }),
  );

  it("creates photo request records and prevents duplicate pending requests", () => {
    const db = getDb();

    const table = db
      .prepare(
        `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name = 'student_photo_requests'
  `,
      )
      .get();

    expect(table).toBeDefined();

    const index = db
      .prepare(
        `
    PRAGMA index_list('student_photo_requests')
  `,
      )
      .all() as any[];

    expect(
      index.some(
        (item) =>
          item.name === "idx_student_photo_one_pending_request" &&
          item.unique === 1,
      ),
    ).toBe(true);

    const requestedAt = new Date().toISOString();

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const insertRequest = db.prepare(`
    INSERT INTO student_photo_requests (
      id,
      student_id,
      source,
      requested_by_admin_id,
      status,
      requested_at,
      expires_at
    )
    VALUES (?, ?, 'STUDENT', NULL, 'PENDING', ?, ?)
  `);

    insertRequest.run(
      "photo-request-test-001",
      "stu-demo-01",
      requestedAt,
      expiresAt,
    );

    expect(() => {
      insertRequest.run(
        "photo-request-test-002",
        "stu-demo-01",
        requestedAt,
        expiresAt,
      );
    }).toThrow();
  });

  async function managerToken() {
    const login = await request(createApp())
      .post("/api/auth/login")
      .send({ username: "admin", password: "AdminPassword123!" });
    return login.body.token as string;
  }

  it("requires a manager, requires finalized verified eligibility, hashes tokens, and sends through the simulator", async () => {
    const app = createApp();
    await request(app)
      .post("/api/students/stu-demo-01/photo-upload-link")
      .expect(401);
    const token = await managerToken();
    await request(app)
      .post("/api/students/stu-demo-06/photo-upload-link")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
    const response = await request(app)
      .post("/api/students/stu-demo-01/photo-upload-link")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const rawToken = response.body.upload_url.split("/").pop();
    const link = getDb()
      .prepare("SELECT * FROM student_photo_upload_links WHERE student_id = ?")
      .get("stu-demo-01") as any;
    expect(link.token_hash).not.toBe(rawToken);
    expect(link.token_hash).toHaveLength(64);
    expect(
      SimulatorProvider.getHistory("+15551001001").some((message) =>
        message.text?.includes(response.body.upload_url),
      ),
    ).toBe(true);
  });

  it("invalidates replacement links and rejects expired or reused tokens", () => {
    const first = StudentPhotoService.issueUploadLink(
      "stu-demo-01",
      "admin-root-01",
    );
    const second = StudentPhotoService.issueUploadLink(
      "stu-demo-01",
      "admin-root-01",
    );
    const firstToken = first.uploadUrl.split("/").pop()!;
    const secondToken = second.uploadUrl.split("/").pop()!;
    expect(() => StudentPhotoService.validateLink(firstToken)).toThrow(
      /invalid, expired/i,
    );
    getDb()
      .prepare(
        "UPDATE student_photo_upload_links SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = ?",
      )
      .run(crypto.createHash("sha256").update(secondToken).digest("hex"));
    expect(() => StudentPhotoService.validateLink(secondToken)).toThrow(
      /invalid, expired/i,
    );

    const usable = StudentPhotoService.issueUploadLink(
      "stu-demo-01",
      "admin-root-01",
    )
      .uploadUrl.split("/")
      .pop()!;
    expect(StudentPhotoService.submitPhoto(usable, jpeg).status).toBe(
      "PENDING_REVIEW",
    );
    expect(() => StudentPhotoService.submitPhoto(usable, jpeg)).toThrow(
      /already been used/i,
    );
  });

  it("rejects non-images and oversized files, stores valid files privately, and associates the student", () => {
    const token = StudentPhotoService.issueUploadLink(
      "stu-demo-01",
      "admin-root-01",
    )
      .uploadUrl.split("/")
      .pop()!;
    expect(() =>
      StudentPhotoService.submitPhoto(token, Buffer.from("not an image")),
    ).toThrow(/valid JPEG/i);
    expect(() =>
      StudentPhotoService.submitPhoto(token, Buffer.alloc(5 * 1024 * 1024 + 1)),
    ).toThrow(/5 MB/i);
    const result = StudentPhotoService.submitPhoto(token, jpeg);
    const student = getDb()
      .prepare(
        "SELECT photo_storage_key, photo_status, photo_url FROM students WHERE id = ?",
      )
      .get("stu-demo-01") as any;
    expect(result.mimeType).toBe("image/jpeg");
    expect(student.photo_status).toBe("PENDING_REVIEW");
    expect(student.photo_storage_key).toMatch(/^[0-9a-f-]+\.jpg$/);
    expect(
      fs.readFileSync(
        path.join(config.photoStorageDir, student.photo_storage_key),
      ),
    ).toEqual(jpeg);
    expect(path.resolve(config.photoStorageDir)).not.toContain(
      `${path.sep}public${path.sep}`,
    );
  });
});
