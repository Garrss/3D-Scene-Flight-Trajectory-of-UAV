import { Suspense, lazy, useEffect, useState } from 'react'
import PlatformShell from './components/PlatformShell'
import { projectFromLocation, projectUrl, type ProjectId } from './lib/projectRoute'

// Route-level splitting: Cesium (~2MB gz) and Three.js only load with the
// workspace that needs them, instead of all engines on first paint.
const FlightWorkspace = lazy(() => import('./components/FlightWorkspace'))
const DigitalTwinWorkspace = lazy(() => import('./components/twin/DigitalTwinWorkspace'))

export default function App() {
  const [project, setProject] = useState<ProjectId>(() => projectFromLocation(window.location))

  useEffect(() => {
    const handlePopState = () => setProject(projectFromLocation(window.location))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const selectProject = (nextProject: ProjectId) => {
    if (nextProject === project) return
    window.history.pushState({}, '', projectUrl(nextProject, window.location))
    setProject(nextProject)
  }

  return (
    <PlatformShell activeProject={project} onSelectProject={selectProject}>
      <Suspense
        fallback={
          <div style={{ padding: 32, color: '#888', fontFamily: 'monospace' }}>Loading the 3D scene…</div>
        }
      >
        {project === 'flight' ? <FlightWorkspace /> : <DigitalTwinWorkspace />}
      </Suspense>
    </PlatformShell>
  )
}
