import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function ProtectedRoute() {
  const { session, loading } = useAuth()
  const location = useLocation()

  // Render nothing while the session is being restored, otherwise a refresh on
  // a protected page would flash the login screen before redirecting back.
  if (loading) return null

  if (!session) return <Navigate to="/login" replace state={{ from: location }} />

  return <Outlet />
}
