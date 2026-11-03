import { Router } from 'express';
import { StudentService } from '../services/studentService.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { StudentRegistrationSchema } from '@hostel/shared';

export const studentRouter = Router();

studentRouter.get('/', (req, res, next) => {
  try {
    const { search, gender, level, limit } = req.query as any;
    const students = StudentService.getStudents({
      search,
      gender,
      level,
      limit: limit ? parseInt(limit, 10) : undefined
    });
    res.json({ students });
  } catch (err) {
    next(err);
  }
});

studentRouter.get('/:id', (req, res, next) => {
  try {
    const student = StudentService.getStudentById(req.params.id);
    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }
    res.json({ student });
  } catch (err) {
    next(err);
  }
});

studentRouter.post('/', authMiddleware, (req: AuthenticatedRequest, res, next) => {
  try {
    const input = StudentRegistrationSchema.parse(req.body);
    const result = StudentService.registerStudent(input, req.admin?.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
