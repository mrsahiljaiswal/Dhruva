import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCloudinaryObjectStorage, createMemoryObjectStorage, createS3ObjectStorage, signCloudinaryParams } from "./storage.js";

describe("object storage", () => {
  it("signs Cloudinary parameters in sorted order", () => {
    const params = { timestamp: 1315060510, public_id: "samplefolder/sample" };
    const expected = createHash("sha1").update("public_id=samplefolder/sample&timestamp=1315060510abcd", "utf8").digest("hex");
    expect(signCloudinaryParams(params, "abcd")).toBe(expected);
  });

  it("limits an S3 upload to the declared type and exact size", async () => {
    const storage = createS3ObjectStorage(
      {
        bucket: "dhruva-resources",
        region: "ap-south-1",
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret",
      },
      () => new Date("2026-11-26T09:30:00.000Z"),
    );
    const slot = await storage.createUploadSlot({
      storageKey: "resources_author_file",
      mimeType: "application/pdf",
      sizeBytes: 1200,
    });

    expect(slot.method).toBe("POST");
    expect(slot.uploadUrl).toBe("https://dhruva-resources.s3.ap-south-1.amazonaws.com");
    const policy = JSON.parse(Buffer.from(slot.fields.policy ?? "", "base64").toString("utf8")) as {
      conditions: unknown[];
    };
    expect(policy.conditions).toContainEqual({ "Content-Type": "application/pdf" });
    expect(policy.conditions).toContainEqual(["content-length-range", 1200, 1200]);
    expect(slot.fields["x-amz-signature"]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("confirms a file only after the client has uploaded it", async () => {
    const storage = createMemoryObjectStorage();
    const slot = await storage.createUploadSlot({
      storageKey: "resources_file",
      mimeType: "text/plain",
      sizeBytes: 12,
    });
    expect(await storage.confirm(slot.storageKey)).toBeNull();
    storage.complete(slot.storageKey);
    expect(await storage.confirm(slot.storageKey)).toEqual({ sizeBytes: 12, mimeType: "text/plain" });
    storage.complete(slot.storageKey, { sizeBytes: 99 });
    expect((await storage.confirm(slot.storageKey))?.sizeBytes).toBe(99);
  });

  it("builds a signed Cloudinary upload without accepting the file bytes", async () => {
    const storage = createCloudinaryObjectStorage(
      { cloudName: "dhruva", apiKey: "key", apiSecret: "abcd" },
      () => new Date("2026-11-26T09:30:00.000Z"),
    );
    const slot = await storage.createUploadSlot({
      storageKey: "resources_author_notes",
      mimeType: "text/plain",
      sizeBytes: 20,
    });
    expect(slot.method).toBe("POST");
    expect(slot.uploadUrl).toBe("https://api.cloudinary.com/v1_1/dhruva/raw/upload");
    expect(slot.fields.signature).toBe(
      signCloudinaryParams(
        { format: "txt", public_id: "resources_author_notes", timestamp: Math.floor(Date.parse("2026-11-26T09:30:00.000Z") / 1000) },
        "abcd",
      ),
    );
    expect(slot.fields.file).toBeUndefined();
  });
});
