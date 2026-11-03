"""Pydantic v2 domain models for IBP Timetable Optimization Service.

Mirrors TypeScript contracts in packages/shared/src/types.ts.
"""

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

InstitutionType = Literal["school", "college", "university", "coaching", "exam"]
ConstraintKind = Literal["HARD", "SOFT"]
ConstraintScope = Literal["global", "faculty", "batch", "room", "subject"]


class UnavailabilityWindow(BaseModel):
    day: str
    start: str
    end: str
    reason: Optional[str] = None


class Department(BaseModel):
    id: str
    name: str
    code: str
    building: Optional[str] = None


class Program(BaseModel):
    id: str
    name: str
    departmentId: str
    durationYears: Optional[int] = None


class StudentGroup(BaseModel):
    id: str
    name: str
    batchId: str
    size: int = 0


class Room(BaseModel):
    id: str
    name: str
    type: str = "theory"
    capacity: int = 60
    building: Optional[str] = None
    floor: Optional[int] = None
    roomNumber: Optional[str] = None
    equipment: List[str] = Field(default_factory=list)
    departmentId: Optional[str] = None
    isShared: bool = True
    features: List[str] = Field(default_factory=list)
    unavail: List[UnavailabilityWindow] = Field(default_factory=list)


class SlotPreference(BaseModel):
    day: str
    start: str
    weight: int = 0


class Faculty(BaseModel):
    id: str
    name: str
    leaves: int = 0
    maxWeeklySlots: int = 20
    minWeeklySlots: Optional[int] = None
    maxDailySlots: Optional[int] = None
    maxConsecutiveSlots: Optional[int] = 4
    minGapBetweenSessions: Optional[int] = 0
    unavail: List[UnavailabilityWindow] = Field(default_factory=list)
    departmentId: Optional[str] = None
    designation: Optional[str] = None
    isPartTime: bool = False
    preferredDaysOff: List[str] = Field(default_factory=list)
    slotPreferences: List[SlotPreference] = Field(default_factory=list)


class Subject(BaseModel):
    id: str
    name: str
    code: Optional[str] = None
    type: Literal["theory", "practical"] = "theory"
    classesPerWeek: int = 1
    sessionLength: int = 1
    facultyId: Optional[str] = None
    facultyIds: List[str] = Field(default_factory=list)
    fixed: bool = False
    fixedDay: Optional[str] = None
    fixedStart: Optional[str] = None
    fixedLength: Optional[int] = None
    unavail: List[UnavailabilityWindow] = Field(default_factory=list)
    batches: List[str] = Field(default_factory=list)
    studentGroups: Optional[List[str]] = None
    capacityRequirement: Optional[int] = None
    preferredRoomTypes: Optional[List[str]] = None
    requiredEquipment: Optional[List[str]] = None
    departmentId: Optional[str] = None
    programId: Optional[str] = None
    splitPattern: Optional[str] = None
    frequency: Optional[Literal["weekly", "alternate_weeks_a", "alternate_weeks_b", "every_day"]] = "weekly"
    isHeavySubject: bool = False


class Break(BaseModel):
    day: str
    start: str
    durationMins: int
    name: Optional[str] = None
    batches: Optional[List[str]] = None


class FixedEvent(BaseModel):
    name: str
    day: str
    start: str
    length: int = 1
    roomType: Literal["theory", "practical"] = "theory"
    room: Optional[str] = None
    batches: Optional[List[str]] = None
    facultyId: Optional[str] = None


class Shift(BaseModel):
    id: str
    name: str
    startTime: str
    endTime: str
    batches: List[str] = Field(default_factory=list)


class ConstraintTemplate(BaseModel):
    id: str
    name: str
    kind: ConstraintKind
    weight: int = 100
    scope: ConstraintScope
    enabled: bool = True
    description: str = ""
    params: Dict[str, Any] = Field(default_factory=dict)


class BuildingTravelMatrix(BaseModel):
    buildings: List[str] = Field(default_factory=list)
    matrix: Dict[str, Dict[str, int]] = Field(default_factory=dict)


class SolverOptions(BaseModel):
    engine: Literal["auto", "ts", "python"] = "auto"
    maxAttempts: int = 5000
    balanceAcrossWeek: bool = True
    timeLimitSeconds: int = 30
    randomSeed: Optional[int] = 42
    numWorkers: int = 4
    customWeights: Dict[str, int] = Field(default_factory=dict)


class RoomsContainer(BaseModel):
    theoryList: List[Room] = Field(default_factory=list)
    labList: List[Room] = Field(default_factory=list)


class SchedulerInputState(BaseModel):
    version: int = 2
    institutionType: Optional[InstitutionType] = "college"
    institutionName: Optional[str] = "Default Institute"
    days: List[str]
    startTime: str
    endTime: str
    slotLength: int = 60
    maxClassesPerDay: int = 6
    rooms: RoomsContainer = Field(default_factory=RoomsContainer)
    batches: List[str]
    batchSizes: Dict[str, int] = Field(default_factory=dict)
    studentGroups: List[StudentGroup] = Field(default_factory=list)
    faculties: List[Faculty] = Field(default_factory=list)
    subjects: List[Subject] = Field(default_factory=list)
    breaks: List[Break] = Field(default_factory=list)
    events: List[FixedEvent] = Field(default_factory=list)
    options: SolverOptions = Field(default_factory=SolverOptions)
    departments: Optional[List[Department]] = None
    programs: Optional[List[Program]] = None
    batchDetails: Optional[Dict[str, Dict[str, Any]]] = None
    shifts: Optional[List[Shift]] = None
    constraints: Optional[List[ConstraintTemplate]] = None
    travelMatrix: Optional[BuildingTravelMatrix] = None


class Timeslot(BaseModel):
    id: str
    day: str
    start: str
    end: str
    startMin: int
    endMin: int
    isBreak: bool = False
    index: int


class Assignment(BaseModel):
    id: str
    subjectId: Optional[str] = None
    subject: str
    facultyId: Optional[str] = None
    facultyIds: List[str] = Field(default_factory=list)
    room: str
    timeslotId: str
    length: int = 1
    batches: List[str]
    studentGroups: Optional[List[str]] = None
    day: Optional[str] = None
    startMin: Optional[int] = None
    endMin: Optional[int] = None
    explanation: Optional[str] = None


class ScheduleSolution(BaseModel):
    timeslots: List[Timeslot]
    byBatch: Dict[str, List[Assignment]]
    byFaculty: Optional[Dict[str, List[Assignment]]] = None
    byRoom: Optional[Dict[str, List[Assignment]]] = None
    roomsByType: Dict[str, List[str]]
    score: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None


class FailureDiagnostic(BaseModel):
    subject: str
    batches: List[str]
    faculty: str
    reason: str
    suggestedRelaxation: Optional[str] = None


class SolverProgress(BaseModel):
    status: Literal["running", "success", "failed", "cancelled", "error"]
    placedSessions: int
    totalSessions: int
    attempts: int
    maxAttempts: int
    solution: Optional[ScheduleSolution] = None
    diagnostics: Optional[List[FailureDiagnostic]] = None
    error: Optional[str] = None
    elapsedMs: Optional[float] = None
    bestScore: Optional[float] = None
