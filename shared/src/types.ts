export type HostelCode = 'MALE' | 'FEMALE';
export type RoomCapacity = 1 | 2 | 3;
export type RoomStatus = 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE';
export type RoommateMode = 'KNOWN' | 'RANDOM';
export type BookingGroupStatus = 'FORMING' | 'READY_FOR_ALLOCATION' | 'ALLOCATED' | 'CANCELLED';
export type GroupMemberRole = 'LEADER' | 'MEMBER';
export type MatchingQueueStatus = 'WAITING' | 'MATCHED' | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type ReconciliationStatus = 'NOT_SUBMITTED' | 'AWAITING_RECONCILIATION' | 'RECONCILED' | 'EXCEPTION' | 'REJECTED';
export type AllocationStatus = 'HOLD' | 'FINALIZED' | 'CANCELLED' | 'MOVED';
export type QRStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';
export type StudentPhotoStatus = 'NOT_SUBMITTED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
export type AccessOutcome = 'GRANTED' | 'DENIED';
export type VerificationMethod = 'CAMERA' | 'MANUAL_ENTRY';
export type AnnouncementAudience = 'ALL' | 'MALE' | 'FEMALE' | 'EXPIRING_SOON' | 'CUSTOM';
export type AnnouncementStatus = 'DRAFT' | 'QUEUED' | 'SENT' | 'SIMULATED' | 'FAILED';
export type RecipientStatus = 'QUEUED' | 'SENT' | 'SIMULATED' | 'DELIVERED' | 'FAILED';

export interface AdminUser {
  id: string;
  username: string;
  full_name: string;
  email: string;
  created_at: string;
}

export interface Hostel {
  id: string;
  code: HostelCode;
  name: string;
  description: string;
  total_capacity: number;
  created_at: string;
}

export interface Room {
  id: string;
  hostel_id: string;
  hostel_code?: HostelCode;
  room_number: string;
  capacity: RoomCapacity;
  price_per_student: number;
  status: RoomStatus;
  current_occupants?: number;
  available_spots?: number;
  held_by_group_id?: string | null;
  occupant_students?: {
    id: string;
    full_name: string;
    phone_number: string;
    allocation_id: string;
    status: AllocationStatus;
  }[];
  created_at: string;
  updated_at: string;
}

export interface Student {
  id: string;
  full_name: string;
  phone_number: string;
  gender: HostelCode;
  department: string;
  academic_level: string;
  preferred_occupancy: RoomCapacity;
  roommate_mode: RoommateMode;
  consent_random_matching: number; // 0 or 1
  photo_url?: string;
  photo_status?: StudentPhotoStatus;
  created_at: string;
  updated_at: string;
  // Computed / joined fields
  current_group?: BookingGroup;
  current_allocation?: RoomAllocation & { room?: Room };
  payment?: Payment;
  qr_credential?: QRCredential;
}

export interface BookingGroup {
  id: string;
  group_code: string;
  hostel_id: string;
  hostel_code?: HostelCode;
  target_capacity: RoomCapacity;
  status: BookingGroupStatus;
  created_by_student_id: string;
  eligible_at?: string | null;
  held_room_id?: string | null;
  auto_complete_triple_consent?: number;
  created_at: string;
  updated_at: string;
  members?: (BookingGroupMember & { student: Student; payment?: Payment })[];
  member_count?: number;
  all_payments_verified?: boolean;
  provisional_room?: { room_number: string; capacity: RoomCapacity; price_per_student: number } | null;
}

export interface BookingGroupMember {
  id: string;
  group_id: string;
  student_id: string;
  role: GroupMemberRole;
  is_matched_from_queue: number;
  auto_complete_triple_consent?: number;
  joined_at: string;
}

export interface MatchingQueueItem {
  id: string;
  student_id: string;
  hostel_id: string;
  hostel_code?: HostelCode;
  target_capacity: RoomCapacity;
  status: MatchingQueueStatus;
  queued_at: string;
  matched_at?: string | null;
  matched_group_id?: string | null;
  student?: Student;
}

export interface Payment {
  id: string;
  student_id: string;
  booking_group_id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  reference_code: string;
  verified_by_admin_id?: string | null;
  verified_at?: string | null;
  notes?: string | null;
  reconciliation_status?: ReconciliationStatus;
  created_at: string;
  updated_at: string;
  student_name?: string;
  student_phone?: string;
  group_code?: string;
}

export interface DemoBankTransaction {
  id: string;
  provider_type: 'DEMO_BANK';
  bank_transaction_reference: string;
  beneficiary_account: string;
  payment_reference: string;
  amount: number;
  currency: string;
  transaction_timestamp: string;
  sender_description: string;
  reconciliation_status: 'PENDING_RECONCILIATION' | 'RECONCILED' | 'EXCEPTION' | 'REJECTED';
  linked_payment_id?: string | null;
  exception_reason?: string | null;
  student_name?: string;
  expected_amount?: number;
}

export interface RoomAllocation {
  id: string;
  room_id: string;
  student_id: string;
  booking_group_id: string;
  status: AllocationStatus;
  allocated_by_admin_id: string;
  accommodation_start_date: string;
  accommodation_end_date: string;
  created_at: string;
  updated_at: string;
  room_number?: string;
  hostel_code?: HostelCode;
  student_name?: string;
}

export interface QRCredential {
  id: string;
  student_id: string;
  room_allocation_id: string;
  token_hash: string;
  status: QRStatus;
  issued_at: string;
  revoked_at?: string | null;
  revoke_reason?: string | null;
  last_issued_at: string;
  qr_image_data?: string;
  created_at: string;
  updated_at: string;
  student?: Student;
  room?: Room;
}

export interface AccessLog {
  id: string;
  qr_credential_id: string;
  student_id: string;
  verified_by_admin_id: string;
  verification_method: VerificationMethod;
  outcome: AccessOutcome;
  reason?: string | null;
  logged_at: string;
  student_name?: string;
  room_number?: string;
  hostel_name?: string;
}

export interface Announcement {
  id: string;
  title: string;
  message: string;
  target_audience: AnnouncementAudience;
  sent_by_admin_id: string;
  status: AnnouncementStatus;
  total_recipients: number;
  created_at: string;
  sent_at?: string | null;
  recipients?: AnnouncementRecipient[];
}

export interface AnnouncementRecipient {
  id: string;
  announcement_id: string;
  student_id: string;
  phone_number: string;
  status: RecipientStatus;
  failure_reason?: string | null;
  sent_at: string;
  student_name?: string;
}

export interface AuditLog {
  id: string;
  admin_id?: string | null;
  admin_username?: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values?: string | null;
  new_values?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface RenewalOverview {
  student_id: string;
  student_name: string;
  phone_number: string;
  gender: HostelCode;
  room_number: string;
  hostel_name: string;
  allocation_id: string;
  accommodation_start_date: string;
  accommodation_end_date: string;
  days_remaining: number;
  urgency: 'EXPIRED' | 'CRITICAL_7_DAYS' | 'WARNING_14_DAYS' | 'NOTICE_30_DAYS' | 'UPCOMING';
  last_reminder_sent_at?: string | null;
  last_reminder_type?: string | null;
}

export interface DashboardStats {
  total_students: number;
  total_male_students: number;
  total_female_students: number;
  total_rooms: number;
  occupied_rooms: number;
  available_rooms: number;
  total_capacity: number;
  current_occupancy: number;
  occupancy_rate: number;
  male_occupancy_rate: number;
  female_occupancy_rate: number;
  pending_payments_count: number;
  verified_payments_count: number;
  active_qr_count: number;
  matching_queue_count: number;
  approaching_renewals_count: number;
}

// WhatsApp Conversation Types
export type WhatsAppState =
  | 'IDLE'
  | 'AWAITING_NAME'
  | 'AWAITING_GENDER'
  | 'AWAITING_DEPT'
  | 'AWAITING_LEVEL'
  | 'AWAITING_OCCUPANCY'
  | 'AWAITING_ROOMMATE_CHOICE'
  | 'AWAITING_AUTO_COMPLETE_CONSENT'
  | 'AWAITING_INVITE_CODE'
  | 'AWAITING_RANDOM_CONSENT';

export interface WhatsAppConversationState {
  id: string;
  phone_number: string;
  current_state: WhatsAppState;
  state_payload: Record<string, any>;
  last_active_at: string;
}

export interface WhatsAppIncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'interactive' | 'button';
  text?: { body: string };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
}

export interface WhatsAppOutgoingMessage {
  to: string;
  type: 'text' | 'interactive' | 'image';
  text?: { body: string };
  interactive?: {
    type: 'button';
    body: { text: string };
    action: {
      buttons: {
        type: 'reply';
        reply: { id: string; title: string };
      }[];
    };
  };
  image?: {
    link?: string;
    caption?: string;
  };
}

export interface WhatsAppProviderStatus {
  is_live: boolean;
  provider_name: 'Meta WhatsApp Cloud API' | 'Local Simulator';
  phone_number_id_configured: boolean;
  access_token_configured: boolean;
  app_secret_configured: boolean;
  webhook_verify_token_configured: boolean;
  public_base_url: string;
  graph_api_version: string;
}
