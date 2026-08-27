import { useState, type FormEvent } from 'react'
import { Dialog } from './ui/Dialog'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import type { ClassInput } from '../services/classes'
import type { CourseLevel } from '../types/database'

const COURSE_LEVELS: CourseLevel[] = ['High School', 'College', 'Graduate']

interface CreateClassDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (input: ClassInput) => Promise<void>
}

export function CreateClassDialog({ open, onClose, onCreate }: CreateClassDialogProps) {
  const [name, setName] = useState('')
  const [courseCode, setCourseCode] = useState('')
  const [professor, setProfessor] = useState('')
  const [semester, setSemester] = useState('')
  const [courseLevel, setCourseLevel] = useState<CourseLevel>('College')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return

    setSubmitting(true)
    try {
      await onCreate({
        name: name.trim(),
        course_code: courseCode.trim(),
        professor: professor.trim(),
        semester: semester.trim(),
        course_level: courseLevel,
      })
      setName('')
      setCourseCode('')
      setProfessor('')
      setSemester('')
      setCourseLevel('College')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Create class">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Class name"
          required
          autoFocus
          placeholder="Biology 101"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Course code"
            placeholder="BIO 101"
            value={courseCode}
            onChange={(event) => setCourseCode(event.target.value)}
          />
          <Input
            label="Semester"
            placeholder="Fall 2026"
            value={semester}
            onChange={(event) => setSemester(event.target.value)}
          />
        </div>
        <Input
          label="Professor"
          value={professor}
          onChange={(event) => setProfessor(event.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="course-level" className="text-sm font-medium text-ink">
            Course level
          </label>
          <select
            id="course-level"
            value={courseLevel}
            onChange={(event) => setCourseLevel(event.target.value as CourseLevel)}
            className="h-9 rounded border border-line-strong bg-surface px-3 text-sm text-ink"
          >
            {COURSE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={submitting}>
            Create class
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
