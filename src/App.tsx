import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import SignUpPage from './pages/SignUpPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ClassesPage from './pages/ClassesPage'
import ClassPage from './pages/ClassPage'
import EditorPage from './pages/EditorPage'
import SharedDocumentPage from './pages/SharedDocumentPage'
import UpgradePage from './pages/UpgradePage'

/**
 * No route requires an account. Signed-out visitors get the full app backed by
 * browser storage; signing in migrates that work into their account. Auth
 * screens remain reachable, but nothing redirects to them.
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/classes" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* Public: a share link must open without an account. What the
              visitor can then do is decided by the owner's chosen mode and
              whether they sign in. */}
          <Route path="/shared/:token" element={<SharedDocumentPage />} />
          <Route path="/upgrade" element={<UpgradePage />} />
          <Route path="/classes" element={<ClassesPage />} />
          <Route path="/classes/:classSlug" element={<ClassPage />} />
          {/* Readable, and one segment shorter: /classes/biology-101/lecture-5 */}
          <Route path="/classes/:classSlug/:noteSlug" element={<EditorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
