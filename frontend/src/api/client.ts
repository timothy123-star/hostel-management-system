const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  details?: any;
  constructor(message: string, status: number, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('hostel_admin_token');
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  if (response.status === 401) {
    localStorage.removeItem('hostel_admin_token');
    localStorage.removeItem('hostel_admin_user');
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login';
    }
  }

  if (response.headers.get('content-type')?.includes('text/csv')) {
    return (await response.text()) as any;
  }

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(data.error || 'API request failed', response.status, data.details);
  }

  return data as T;
}

export const api = {
  // Auth
  login: (credentials: { username: string; password: string }) =>
    apiRequest<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials)
    }),
  getMe: () => apiRequest<{ user: any }>('/auth/me'),

  // Hostels & Rooms
  getHostels: () => apiRequest<{ hostels: any[] }>('/hostels'),
  getRooms: (hostel?: string) => apiRequest<{ rooms: any[] }>(`/hostels/rooms${hostel ? `?hostel=${hostel}` : ''}`),
  createRoom: (data: any) => apiRequest<{ room: any }>('/hostels/rooms', { method: 'POST', body: JSON.stringify(data) }),
  updateRoomPrice: (id: string, price: number) =>
    apiRequest<{ room: any }>(`/hostels/rooms/${id}/price`, {
      method: 'PATCH',
      body: JSON.stringify({ price_per_student: price })
    }),

  // Students
  getStudents: (params?: { search?: string; gender?: string; level?: string; limit?: number }) => {
    const q = new URLSearchParams(Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== '') as [string, string][]).toString();
    return apiRequest<{ students: any[] }>(`/students${q ? `?${q}` : ''}`);
  },
  getStudentById: (id: string) => apiRequest<{ student: any }>(`/students/${id}`),
  registerStudent: (data: any) => apiRequest<{ student: any; group?: any; queueItem?: any }>('/students', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  issueStudentPhotoUploadLink: (studentId: string) => apiRequest<{ upload_url: string; expires_at: string; delivery: 'SIMULATED' }>(`/students/${studentId}/photo-upload-link`, { method: 'POST' }),
  getPhotoReviews: (status = 'PENDING_REVIEW') => apiRequest<{ reviews: any[] }>(`/photo-reviews?status=${encodeURIComponent(status)}`),
  getPhotoReviewHistory: (studentId: string) => apiRequest<{ history: any[] }>(`/photo-reviews/${studentId}/history`),
  approvePhoto: (studentId: string, submissionId?: string) => apiRequest<{ review: any }>(`/photo-reviews/${studentId}/approve`, { method: 'POST', body: JSON.stringify({ submission_id: submissionId }) }),
  rejectPhoto: (studentId: string, reason: string, submissionId?: string) => apiRequest<{ review: any }>(`/photo-reviews/${studentId}/reject`, { method: 'POST', body: JSON.stringify({ reason, submission_id: submissionId }) }),
  requestReplacementPhoto: (studentId: string) => apiRequest<{ upload_url: string; expires_at: string }>(`/photo-reviews/${studentId}/request-replacement`, { method: 'POST' }),
  getPhotoDisplayConsent: (studentId: string) => apiRequest<{ consent: any; history: any[] }>(`/photo-display-consent/${encodeURIComponent(studentId)}`),
  withdrawPhotoDisplayConsent: (studentId: string, reason?: string) => apiRequest<{ consent: any }>(`/photo-display-consent/${encodeURIComponent(studentId)}/withdraw`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // Booking Groups & Queue
  getBookingGroups: (hostel?: string, status?: string) => {
    const q = new URLSearchParams({ ...(hostel && { hostel }), ...(status && { status }) }).toString();
    return apiRequest<{ groups: any[] }>(`/bookings/groups${q ? `?${q}` : ''}`);
  },
  getBookingGroupById: (id: string) => apiRequest<{ group: any }>(`/bookings/groups/${id}`),
  getMatchingQueue: (hostel?: string, status?: string, capacity?: number) => {
    const q = new URLSearchParams({ ...(hostel && { hostel }), ...(status && status !== 'ALL' && { status }), ...(capacity && { capacity: String(capacity) }) }).toString();
    return apiRequest<{ queue: any[] }>(`/bookings/matching-queue${q ? `?${q}` : ''}`);
  },
  runMatching: (hostel?: string, capacity?: number) => apiRequest<{ processed: number }>('/bookings/matching/run', {
    method: 'POST', body: JSON.stringify({ hostel, capacity })
  }),
  completeGroupFromQueue: (groupId: string, queueItemId: string) => apiRequest<{ group: any }>(`/bookings/groups/${groupId}/complete-from-queue`, {
    method: 'POST', body: JSON.stringify({ queue_item_id: queueItemId })
  }),

  // Payments
  getPayments: (status?: string, hostel?: string) => {
    const q = new URLSearchParams({ ...(status && { status }), ...(hostel && { hostel }) }).toString();
    return apiRequest<{ payments: any[] }>(`/payments${q ? `?${q}` : ''}`);
  },
  verifyPayment: (id: string, notes?: string) =>
    apiRequest<{ payment: any }>(`/payments/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify({ notes })
    }),
  rejectPayment: (id: string, reason: string) =>
    apiRequest<{ payment: any }>(`/payments/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    }),
  getDemoTransactions: (status?: string) => apiRequest<{ transactions: any[] }>(`/payments/demo-transactions${status ? `?status=${status}` : ''}`),
  reconcileDemoTransaction: (id: string) => apiRequest<any>(`/payments/demo-transactions/${id}/reconcile`, { method: 'POST' }),
  rejectDemoTransaction: (id: string, reason: string) => apiRequest<any>(`/payments/demo-transactions/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // Allocation
  finalizeAllocation: (data: { groupId: string; accommodationStartDate: string; overrideRoomId?: string; overrideReason?: string }) =>
    apiRequest<{ allocations: any[] }>('/allocations/finalize', {
      method: 'POST',
      body: JSON.stringify({
        group_id: data.groupId,
        accommodation_start_date: data.accommodationStartDate,
        override_room_id: data.overrideRoomId,
        override_reason: data.overrideReason
      })
    }),
  reallocateStudent: (data: { studentId: string; newRoomId: string; reason: string }) =>
    apiRequest<{ allocation: any }>('/allocations/reallocate', {
      method: 'POST',
      body: JSON.stringify({
        student_id: data.studentId,
        new_room_id: data.newRoomId,
        reason: data.reason
      })
    }),
  reallocateGroup: (data: { groupId: string; newRoomId: string; reason: string }) =>
    apiRequest<{ allocations: any[] }>(`/allocations/groups/${data.groupId}/reallocate`, {
      method: 'POST', body: JSON.stringify({ new_room_id: data.newRoomId, reason: data.reason })
    }),

  // QR & Access
  verifyQR: (token: string, method: 'CAMERA' | 'MANUAL_ENTRY' = 'MANUAL_ENTRY') =>
    apiRequest<any>('/qr/verify', {
      method: 'POST',
      body: JSON.stringify({ token, method })
    }),
  getStaffVerification: (token: string) =>
    apiRequest<any>(`/qr/staff/${encodeURIComponent(token)}`),
  fetchStaffPhoto: async (photoUrl: string): Promise<string> => {
    const adminToken = localStorage.getItem('hostel_admin_token');
    const response = await fetch(photoUrl, {
      headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : {},
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('Approved photograph is unavailable.');
    return URL.createObjectURL(await response.blob());
  },
  getQRCredentials: () => apiRequest<{ credentials: any[] }>('/qr/credentials'),
  issueQRCredential: (studentId: string, reissue = false) =>
    apiRequest<any>(`/qr/credentials/${studentId}/issue`, { method: 'POST', body: JSON.stringify({ reissue }) }),
  revokeQR: (id: string, reason: string) =>
    apiRequest<any>(`/qr/${id}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    }),
  getAccessLogs: () => apiRequest<{ accessLogs: any[] }>('/qr/access-logs'),

  // Renewals
  getRenewals: (urgency?: string) => apiRequest<{ renewals: any[] }>(`/renewals${urgency ? `?urgency=${urgency}` : ''}`),
  sendRenewalReminders: (studentIds: string[], reminderType: string) =>
    apiRequest<any>('/renewals/send-reminders', {
      method: 'POST',
      body: JSON.stringify({ student_ids: studentIds, reminder_type: reminderType })
    }),

  // Announcements
  getAnnouncements: () => apiRequest<{ announcements: any[] }>('/announcements'),
  getAnnouncementById: (id: string) => apiRequest<{ announcement: any }>(`/announcements/${id}`),
  previewAnnouncement: (data: any) =>
    apiRequest<{ previewText: string; totalRecipients: number; recipients: any[] }>('/announcements/preview', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  sendAnnouncement: (data: any) =>
    apiRequest<{ announcement: any }>('/announcements/send', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  // Statistics & Reports
  getOverviewStats: () => apiRequest<{ stats: any }>('/stats/overview'),
  downloadReportUrl: (type: string) => `${API_BASE}/reports/export/${type}`,

  // Audit Logs
  getAuditLogs: (limit = 100) => apiRequest<{ logs: any[] }>(`/audit-logs?limit=${limit}`),

  // WhatsApp
  getWhatsAppStatus: () => apiRequest<{ status: any }>('/whatsapp/status'),
  getInboxFailures: (limit = 20, offset = 0) =>
    apiRequest<{ failed_count: number; retryable_count: number; received_count: number; failures: any[]; limit: number; offset: number }>(
      `/whatsapp/inbox/failures?limit=${limit}&offset=${offset}`
    ),
  getSimulatorHistory: (phone?: string) =>
    apiRequest<{ history: any[] }>(`/whatsapp/simulator/history${phone ? `?phone=${encodeURIComponent(phone)}` : ''}`),
  sendSimulatorMessage: (data: { from: string; textBody?: string; buttonId?: string }) =>
    apiRequest<any>('/whatsapp/simulator/send', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  clearSimulatorHistory: () =>
    apiRequest<any>('/whatsapp/simulator/clear', {
      method: 'POST'
    })
};
