import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { universityById } from '@komogon/core';
import type { SchoolSummary } from '../../lib/api';

/** Only curated school marks, never a third-party logo lookup containing user details. */
export function SchoolMark({ school }: { school: SchoolSummary }) {
  const [failed, setFailed] = useState(false);
  const mark = universityById(school.id) ?? school;
  return (
    <span className="school-mark" title={mark.crestCredit ?? school.name}>
      {mark.crestUrl && !failed ? (
        <img
          src={mark.crestUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <GraduationCap size={22} aria-hidden />
      )}
    </span>
  );
}
