import { z } from 'zod';

export const LoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
});
export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * Shared input normalization.
 * NFC canonicalizes composed vs decomposed Unicode so equivalent
 * spellings compare equally. Trimming plus collapsing repeated
 * whitespace removes transport noise. Capitalization, accents,
 * apostrophes, hyphens and non-Latin scripts are preserved.
 */
export function normalizeFreeText(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/**
 * Control characters with no legitimate place in a stored name,
 * department or level. U+200C (ZWNJ) and U+200D (ZWJ) are
 * deliberately allowed because several scripts require them.
 */
const DISALLOWED_CONTROLS_PATTERN: RegExp = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u0080-\\u009F\\u2028\\u2029]',
);

function textField(label: string, min: number, max: number) {
  return z
    .string()
    .min(1, `${label} is required`)
    .transform((s) => normalizeFreeText(s))
    .refine((s) => s.length >= min, {
      message: `${label} must have at least ${min} characters`,
    })
    .refine((s) => s.length <= max, {
      message: `${label} must be ${max} characters or fewer`,
    })
    .refine((s) => !DISALLOWED_CONTROLS_PATTERN.test(s), {
      message: `${label} contains unsupported control characters`,
    });
}

export const FullNameSchema = textField('Full name', 2, 100);
export const DepartmentSchema = textField('Department', 2, 80);
export const AcademicLevelSchema = textField('Academic level', 1, 60);

/**
 * Canonical phone for new records: E.164-style plus followed by 7-15
 * digits. Meta delivers WhatsApp senders as digits without the leading
 * plus, while existing rows use plus-prefixed values. This only adds
 * the missing plus and strips visual separators; it never invents a
 * country code.
 */
export function normalizePhoneNumber(input: string): string {
  const compact = input.trim().replace(/[\s\-.()]/g, '');
  if (compact.startsWith('+')) {
    return `+${compact.slice(1).replace(/\D/g, '')}`;
  }
  return `+${compact.replace(/\D/g, '')}`;
}

export function isValidCanonicalPhone(value: string): boolean {
  return /^\+\d{7,15}$/.test(value);
}

/** Lookup candidates covering canonical and legacy stored forms. */
export function phoneLookupCandidates(input: string): string[] {
  const trimmed = input.trim();
  const candidates = new Set<string>();
  if (trimmed) candidates.add(trimmed);
  const canonical = normalizePhoneNumber(input);
  if (isValidCanonicalPhone(canonical)) candidates.add(canonical);
  const digits = trimmed.replace(/\D/g, '');
  if (digits) {
    candidates.add(digits);
    candidates.add(`+${digits}`);
  }
  return [...candidates];
}

export const PhoneNumberSchema = z
  .string()
  .min(6, 'Valid phone number is required')
  .transform((s) => normalizePhoneNumber(s))
  .refine((s) => isValidCanonicalPhone(s), {
    message: 'Valid phone number is required',
  });

/** Real invite-code format from BookingGroupService.generateGroupCode. */
export const GROUP_CODE_PATTERN = /^GRP-[A-HJ-NP-Z2-9]{4}$/;

export const GroupInviteCodeSchema = z
  .string()
  .min(1, 'Invitation code is required')
  .transform((s) => s.trim().toUpperCase().replace(/\s+/g, ''))
  .refine((s) => GROUP_CODE_PATTERN.test(s), {
    message: 'Invitation code must look like GRP-XXXX',
  });

export const StudentRegistrationSchema = z.object({
  full_name: FullNameSchema,
  phone_number: PhoneNumberSchema,
  gender: z.enum(['MALE', 'FEMALE'], { message: 'Gender must be MALE or FEMALE' }),
  department: DepartmentSchema,
  academic_level: AcademicLevelSchema,
  preferred_occupancy: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  roommate_mode: z.enum(['KNOWN', 'RANDOM']),
  consent_random_matching: z.boolean().default(false),
  auto_complete_triple_consent: z.boolean().default(false),
  group_invite_code: GroupInviteCodeSchema.optional(),
});
export type StudentRegistrationInput = z.infer<typeof StudentRegistrationSchema>;

/** Meta webhook envelope; passthrough so extra Meta fields are allowed. */
export const WhatsAppInboundMessageSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    type: z.string().min(1),
    text: z.object({ body: z.string() }).passthrough().optional(),
    interactive: z.unknown().optional(),
    button: z.unknown().optional(),
    image: z
      .object({
        id: z.string().min(1),
        mime_type: z.string().optional(),
        caption: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type WhatsAppInboundMessage = z.infer<typeof WhatsAppInboundMessageSchema>;

export const WhatsAppWebhookSchema = z
  .object({
    entry: z
      .array(
        z
          .object({
            changes: z
              .array(
                z
                  .object({
                    value: z
                      .object({
                        messages: z.array(WhatsAppInboundMessageSchema).optional(),
                        statuses: z.array(z.unknown()).optional(),
                      })
                      .passthrough()
                      .optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export type WhatsAppWebhook = z.infer<typeof WhatsAppWebhookSchema>;

export const UpdateRoomPriceSchema = z.object({
  price_per_student: z.number().positive('Price must be a positive number')
});
export type UpdateRoomPriceInput = z.infer<typeof UpdateRoomPriceSchema>;

export const CreateRoomSchema = z.object({
  hostel_id: z.string().min(1),
  room_number: z.string().min(1),
  capacity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  price_per_student: z.number().positive()
});
export type CreateRoomInput = z.infer<typeof CreateRoomSchema>;

export const ReallocateStudentSchema = z.object({
  student_id: z.string().min(1, 'Student ID is required'),
  new_room_id: z.string().min(1, 'New room ID is required'),
  reason: z.string().min(3, 'Reason for reallocation is required for audit')
});
export type ReallocateStudentInput = z.infer<typeof ReallocateStudentSchema>;

export const VerifyPaymentSchema = z.object({
  notes: z.string().optional()
});
export type VerifyPaymentInput = z.infer<typeof VerifyPaymentSchema>;

export const RejectPaymentSchema = z.object({
  reason: z.string().min(3, 'Rejection reason is required')
});
export type RejectPaymentInput = z.infer<typeof RejectPaymentSchema>;

export const FinalizeAllocationSchema = z.object({
  group_id: z.string().min(1, 'Group ID is required'),
  override_room_id: z.string().optional(),
  override_reason: z.string().optional(),
  accommodation_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid YYYY-MM-DD date required')
});
export type FinalizeAllocationInput = z.infer<typeof FinalizeAllocationSchema>;

export const SendRenewalReminderSchema = z.object({
  student_ids: z.array(z.string().min(1)).min(1, 'At least one student must be selected'),
  reminder_type: z.enum(['30_DAYS', '14_DAYS', '7_DAYS', 'MANUAL_NOTICE'])
});
export type SendRenewalReminderInput = z.infer<typeof SendRenewalReminderSchema>;

export const ComposeAnnouncementSchema = z.object({
  title: z.string().min(3, 'Title is required (min 3 chars)'),
  message: z.string().min(5, 'Message body is required (min 5 chars)'),
  target_audience: z.enum(['ALL', 'MALE', 'FEMALE', 'EXPIRING_SOON', 'CUSTOM']),
  student_ids: z.array(z.string()).optional()
});
export type ComposeAnnouncementInput = z.infer<typeof ComposeAnnouncementSchema>;

export const VerifyQRTokenSchema = z.object({
  token: z.string().min(6, 'Valid QR verification token is required'),
  method: z.enum(['CAMERA', 'MANUAL_ENTRY']).default('MANUAL_ENTRY')
});
export type VerifyQRTokenInput = z.infer<typeof VerifyQRTokenSchema>;

export const RevokeQRSchema = z.object({
  reason: z.string().min(3, 'Reason for revocation is required')
});
export type RevokeQRInput = z.infer<typeof RevokeQRSchema>;
