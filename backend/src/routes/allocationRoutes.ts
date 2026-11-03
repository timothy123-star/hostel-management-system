import { Router } from 'express';
import { AllocationService } from '../services/allocationService.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { FinalizeAllocationSchema, ReallocateStudentSchema } from '@hostel/shared';

export const allocationRouter = Router();

allocationRouter.post('/finalize', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = FinalizeAllocationSchema.parse(req.body);
    const result = await AllocationService.finalizeGroupAllocation({
      groupId: input.group_id,
      adminId: req.admin?.id,
      overrideRoomId: input.override_room_id,
      overrideReason: input.override_reason,
      accommodationStartDate: input.accommodation_start_date
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

allocationRouter.post('/reallocate', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try {
    const input = ReallocateStudentSchema.parse(req.body);
    const allocation = AllocationService.reallocateStudent({
      studentId: input.student_id,
      newRoomId: input.new_room_id,
      reason: input.reason,
      adminId: req.admin?.id
    });
    res.json({ allocation });
  } catch (err) {
    next(err);
  }
});

allocationRouter.post('/groups/:id/reallocate', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try {
    const { new_room_id, reason } = req.body;
    if (!new_room_id || !reason || reason.trim().length < 3) throw new Error('A target room and documented reason are required.');
    res.json({ allocations: AllocationService.reallocateGroup({ groupId: req.params.id, newRoomId: new_room_id, reason: reason.trim(), adminId: req.admin?.id }) });
  } catch (err) { next(err); }
});
