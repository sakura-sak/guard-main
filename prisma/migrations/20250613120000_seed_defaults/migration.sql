-- Default institution, faculties, document types, and role accounts (idempotent).

INSERT INTO institutions (id, name, created_at)
VALUES ('bsuir', 'БГУИР', NOW())
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO faculties (id, name, institution_id, created_at)
VALUES
  ('fitu', 'Факультет информационных технологий и управления', 'bsuir', NOW()),
  ('fksis', 'Факультет компьютерных систем и сетей', 'bsuir', NOW()),
  ('fkaf', 'Факультет компьютерного проектирования', 'bsuir', NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  institution_id = EXCLUDED.institution_id;

INSERT INTO document_types (name, display_name, is_active, created_at)
VALUES
  ('diploma', 'Дипломная работа / проект', true, NOW()),
  ('coursework', 'Курсовая работа / проект', true, NOW()),
  ('lab', 'Лабораторная работа', true, NOW()),
  ('practice', 'Практическая работа', true, NOW()),
  ('article', 'Статьи', true, NOW())
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  is_active = EXCLUDED.is_active;

INSERT INTO users (username, password, role, full_name, institution_id, faculty_id, group_name, created_at)
VALUES
  ('superadmin', 'superadmin', 'superadmin', 'Главный администратор', 'bsuir', NULL, NULL, NOW()),
  ('admin', 'admin', 'admin', 'Администратор БГУИР', 'bsuir', NULL, NULL, NOW()),
  ('student', 'student', 'student', 'Студент Тестовый', 'bsuir', 'fitu', '213801', NOW()),
  ('teacher', 'teacher', 'teacher', 'Преподаватель Тестовый', 'bsuir', NULL, '—', NOW())
ON CONFLICT (username) DO UPDATE SET
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name,
  institution_id = EXCLUDED.institution_id,
  faculty_id = EXCLUDED.faculty_id,
  group_name = EXCLUDED.group_name;
