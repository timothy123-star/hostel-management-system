import { Router } from 'express';
import { HostelService } from '../services/hostelService.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { UpdateRoomPriceSchema, CreateRoomSchema } from '@hostel/shared';

export const hostelRouter = Router();

hostelRouter.get('/', (req, res, next) => {
  try {
    const hostels = HostelService.getHostels();
    res.json({ hostels });
  } catch (err) {
    next(err);
  }
});

hostelRouter.get('/rooms', (req, res, next) => {
  try {
    const hostelCode = req.query.hostel as any;
    const rooms = HostelService.getRooms(hostelCode);
    res.json({ rooms });
  } catch (err) {
    next(err);
  }
});

hostelRouter.post('/rooms', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try {
    const input = CreateRoomSchema.parse(req.body);
    const room = HostelService.createRoom({
      hostelId: input.hostel_id,
      roomNumber: input.room_number,
      capacity: input.capacity,
      pricePerStudent: input.price_per_student,
      adminId: req.admin?.id
    });
    res.status(201).json({ room });
  } catch (err) {
    next(err);
  }
});

hostelRouter.patch('/rooms/:id/price', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try {
    const input = UpdateRoomPriceSchema.parse(req.body);
    const room = HostelService.updateRoomPrice(req.params.id, input.price_per_student, req.admin?.id);
    res.json({ room });
  } catch (err) {
    next(err);
  }
});
