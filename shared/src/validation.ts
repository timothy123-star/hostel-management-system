import { z } from 'zod';

export const LoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const StudentRegistrationSchema = z.object({
  full_name: z.string().min(2, 'Full name must have at least 2 characters'),
  phone_number: z.string().min(6, 'Valid phone number is required'),
  gender: z.enum(['MALE', 'FEMALE'], { message: 'Gender must be MALE or FEMALE' }),
  department: z.string().min(2, 'Department is required'),
  academic_level: z.string().min(1, 'Academic level is required'),
  preferred_occupancy: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  roommate_mode: z.enum(['KNOWN', 'RANDOM']),
  consent_random_matching: z.boolean().default(false),
  group_invite_code: z.string().optional()
});
export type StudentRegistrationInput = z.infer<typeof StudentRegistrationSchema>;

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
