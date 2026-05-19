import React, { useEffect, useState } from 'react';
import api from './src/api/client.js';
import AuthView from './src/components/AuthView.jsx';
import AdminDashboard from './src/components/AdminDashboard.jsx';
import UserDashboard from './src/components/UserDashboard.jsx';
import Toast from './src/components/Toast.jsx';
import { getStatusLabel } from './src/utils/status.js';

///////// AIserver 연동
import aiApi from './src/api/AIclient.js';

const INITIAL_COMPLAINT_INFO = {
  location: '',
  address: '',
  space_type: '',
  defect_area: '',
  urgency: '보통',
  contact_phone: ''
};

function makeToast(message, type = 'info') {
  return { id: Date.now(), message, type };
}

function buildAnalysisText(analysis) {
  const relatedLaws = Array.isArray(analysis.relatedLaws)
    ? analysis.relatedLaws.join(', ')
    : analysis.relatedLaws || '정보 없음';

  return [
    `하자 내용: ${analysis.defectContent || '미분류'}`,
    `심각도: ${analysis.severityScore ?? '미정'}`,
    `예상 해결 방법: ${analysis.expectedSolution || '정보 없음'}`,
    `처리 방법: ${analysis.processingMethod || '정보 없음'}`,
    `관련 법규: ${relatedLaws}`
  ].join('\n');
}

function normalizeAnalysisResult(result = {}) {
  return {
    defectContent: result.defectContent || '',
    severityScore: Number(result.severityScore) || 1,
    expectedSolution: result.expectedSolution || '',
    processingMethod: result.processingMethod || '',
    relatedLaws: Array.isArray(result.relatedLaws)
      ? result.relatedLaws.join(', ')
      : result.relatedLaws || ''
  };
}

function ConstructionChatbot() {

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [authView, setAuthView] = useState('login');
  const [authData, setAuthData] = useState({ userid: '', password: '', name: '' });
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [selectedImages, setSelectedImages] = useState([]);
  const [imageStatus, setImageStatus] = useState('idle');
  const [imageError, setImageError] = useState('');
  const [reports, setReports] = useState([]);
  const [allReports, setAllReports] = useState([]);
  const [toast, setToast] = useState(null);
  const [complaintStep, setComplaintStep] = useState('upload');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [editedAnalysis, setEditedAnalysis] = useState(null);
  const [complaintInfo, setComplaintInfo] = useState(INITIAL_COMPLAINT_INFO);

  const showToast = (message, type = 'info') => {
    setToast(makeToast(message, type));
  };

  const fetchMyReports = async (userId) => {
    try {
      const targetId = userId || user?.id;
      if (!targetId) return;

      const res = await api.get(`/api/my-reports/${targetId}`);
      setReports(res.data);
    } catch (error) {
      showToast(error.response?.data?.error || '민원 목록을 불러오지 못했습니다.', 'error');
    }
  };

  const fetchAllReports = async () => {
    try {
      const res = await api.get('/api/admin/all-reports');
      setAllReports(res.data);
    } catch (error) {
      showToast(error.response?.data?.error || '관리자 목록을 불러오지 못했습니다.', 'error');
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    const name = localStorage.getItem('userName');
    const id = localStorage.getItem('userId');
    const savedRole = localStorage.getItem('userRole');

    if (!token) return;

    setIsLoggedIn(true);
    setUser({ name, id: Number(id) });
    setRole(savedRole);

    if (savedRole === 'admin') {
      fetchAllReports();
    } else {
      fetchMyReports(id);
    }
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const updateStatus = async (id, newStatus) => {
    try {
      await api.put(`/api/report-status/${id}`, { status: newStatus });
      showToast(`상태가 [${getStatusLabel(newStatus)}]로 변경되었습니다.`, 'success');
      fetchAllReports();
    } catch (error) {
      showToast(error.response?.data?.error || '상태 변경에 실패했습니다.', 'error');
    }
  };

  const handleAuth = async () => {
    const url = authView === 'login' ? '/api/login' : '/api/signup';

    try {
      const res = await api.post(url, authData);

      if (authView === 'signup') {
        showToast('회원가입이 완료되었습니다. 로그인해 주세요.', 'success');
        setAuthView('login');
        return;
      }

      localStorage.setItem('token', res.data.token);
      localStorage.setItem('userName', res.data.name);
      localStorage.setItem('userId', res.data.id);
      localStorage.setItem('userRole', res.data.role);

      setUser({ name: res.data.name, id: res.data.id });
      setRole(res.data.role);
      setIsLoggedIn(true);

      if (res.data.role === 'admin') {
        fetchAllReports();
      } else {
        fetchMyReports(res.data.id);
      }
    } catch (error) {
      showToast(error.response?.data?.error || '오류가 발생했습니다.', 'error');
    }
  };

  const resetComplaintFlow = () => {
    setComplaintStep('upload');
    setInput('');
    setMessages([]);
    setAnalysisResult(null);
    setEditedAnalysis(null);
    setComplaintInfo(INITIAL_COMPLAINT_INFO);
  };

  const clearImages = () => {
    selectedImages.forEach((image) => URL.revokeObjectURL(image.preview));
    setSelectedImages([]);
    setImageStatus('idle');
    setImageError('');
  };

  const handleStartNewReport = () => {
    clearImages();
    resetComplaintFlow();
  };

  const handleLogout = () => {
    localStorage.clear();
    setIsLoggedIn(false);
    setUser(null);
    setRole(null);
    setReports([]);
    setAllReports([]);
    clearImages();
    resetComplaintFlow();
  };

  const prepareImageFile = (file) => new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('이미지 파일만 선택할 수 있습니다.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSide = 1280;
        const scaleSize = Math.min(1, maxSide / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scaleSize);
        canvas.height = Math.round(img.height * scaleSize);

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 0.72);

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('이미지를 변환하지 못했습니다.'));
            return;
          }

          const normalizedName = file.name.replace(/\.[^.]+$/, '') || 'defect-photo';
          const optimizedFile = new File([blob], `${normalizedName}.jpg`, { type: 'image/jpeg' });

          resolve({
            id: crypto.randomUUID(),
            name: file.name,
            preview: URL.createObjectURL(optimizedFile),
            base64,
            file: optimizedFile,
            width: canvas.width,
            height: canvas.height
          });
        }, 'image/jpeg', 0.82);
      };
      img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
      img.src = loadEvent.target.result;
    };
    reader.onerror = () => reject(new Error('이미지 파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });

  const handleImageFiles = async (files) => {
    const imageFiles = files.filter(Boolean);
    if (imageFiles.length === 0) return;

    setImageStatus('processing');
    setImageError('');

    try {
      const prepared = await Promise.all(imageFiles.map(prepareImageFile));
      setSelectedImages((prev) => {
        const next = [...prev, ...prepared].slice(0, 10);
        if (next.length < prev.length + prepared.length) {
          showToast('이미지는 최대 10장까지 등록할 수 있습니다.', 'info');
        }
        return next;
      });
      setImageStatus('ready');
      setComplaintStep('upload');
    } catch (error) {
      setImageStatus('error');
      setImageError(error.message);
      showToast(error.message, 'error');
    }
  };

  const handleImageUpload = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    handleImageFiles(files);
  };

  const removeImage = (imageId) => {
    setSelectedImages((prev) => {
      const target = prev.find((image) => image.id === imageId);
      if (target) URL.revokeObjectURL(target.preview);
      const next = prev.filter((image) => image.id !== imageId);
      setImageStatus(next.length > 0 ? 'ready' : 'idle');
      return next;
    });
  };

  const handleAnalyzeReport = async () => {
    if (selectedImages.length === 0) {
      showToast('AI 분석을 위해 하자 사진을 먼저 선택해 주세요.', 'error');
      return;
    }

    if (imageStatus === 'processing') {
      showToast('이미지를 준비하는 중입니다. 잠시 후 다시 시도해 주세요.', 'info');
      return;
    }

    setLoading(true);
    setComplaintStep('analysis');

    const userMessage = {
      role: 'user',
      content: input || '사진 속 건설 하자를 분석해 주세요.'
    };

    const updatedMessages = [userMessage];
    setMessages(updatedMessages);


    /// 2026, 05, 18 수정 (실시간 객체를 탐색하는 YOLO의 결과값을 메세지 객체에 같이 저장하기 위함.)
    try {
     const fd = new FormData();
      fd.append('image', selectedImages[0].file);
      fd.append('message', input || '사진 속 건설 하자를 분석해 주세요.');
      const res = await aiApi.post('/api/ai/analyze-image', fd);

      const normalized = normalizeAnalysisResult(res.data.diagnosis || {});
      const assistantMessage = {
        role: 'assistant',
        content: buildAnalysisText(normalized),
        structuredResult: normalized,
        yolo: res.data.yolo,
        //////// report.js (getReportSummary) 호환을 위한 추가 ////////
        analysis_json: normalized,
        defect_type: normalized.defectContent,
        severity_score: normalized.severityScore
        //////// ////////
      };

      setMessages([...updatedMessages, assistantMessage]);
      setAnalysisResult(assistantMessage);
      setEditedAnalysis(normalized);
      showToast('AI 분석이 완료되었습니다. 결과를 확인해 주세요.', 'success');
    } catch (error) {
      setComplaintStep('upload');
      showToast(error.response?.data?.error || '분석 중 오류가 발생했습니다.', 'error');
    } finally {
      setLoading(false);                            
    }
  };

  const updateComplaintInfo = (field, value) => {
    setComplaintInfo((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const validateComplaintInfo = () => {
    if (!editedAnalysis) return 'AI 분석 결과를 먼저 확인해 주세요.';
    if (!editedAnalysis.defectContent.trim()) return 'AI 분석 결과의 하자 내용이 누락되었습니다.';
    if (!editedAnalysis.expectedSolution.trim()) return 'AI 분석 결과의 예상 해결 방법이 누락되었습니다.';
    if (!editedAnalysis.processingMethod.trim()) return 'AI 분석 결과의 처리 방법이 누락되었습니다.';
    if (!editedAnalysis.relatedLaws.trim()) return 'AI 분석 결과의 관련 법규가 누락되었습니다.';
    if (editedAnalysis.severityScore < 1 || editedAnalysis.severityScore > 10) {
      return '심각도는 1~10 사이로 입력해 주세요.';
    }
    if (!input.trim()) return '민원 설명을 입력해 주세요.';
    if (!complaintInfo.location.trim()) return '현장 위치를 입력해 주세요.';
    if (!complaintInfo.defect_area.trim()) return '하자 발생 부위를 입력해 주세요.';
    if (!complaintInfo.contact_phone.trim()) return '연락처를 입력해 주세요.';
    return null;
  };

  const saveToDB = async () => {
    const validationError = validateComplaintInfo();
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }

    if (selectedImages.length === 0) {
      showToast('민원 접수를 위해 하자 사진을 선택해 주세요.', 'error');
      return;
    }

    const structured = {
      ...editedAnalysis,
      severityScore: Number(editedAnalysis.severityScore),
      relatedLaws: editedAnalysis.relatedLaws
    };
    const finalAnalysisText = buildAnalysisText(structured);

    const formData = new FormData();
    formData.append('user_id', user.id);
    formData.append('analysis_result', finalAnalysisText);
    formData.append('analysis_text', finalAnalysisText);
    formData.append('structured_analysis', JSON.stringify(structured));
    Object.entries(complaintInfo).forEach(([key, value]) => {
      formData.append(key, value);
    });
    formData.append('user_description', input.trim());
    selectedImages.forEach((image) => {
      formData.append('images', image.file);
    });

    try {
      await api.post('/api/register-report', formData);
      showToast('민원이 정상적으로 접수되었습니다.', 'success');
      setComplaintStep('complete');
      fetchMyReports();
    } catch (error) {
      const serverError = error.response?.data;
      showToast(serverError?.detail || serverError?.error || '민원 접수에 실패했습니다.', 'error');
    }
  };

  const deleteReport = async (reportId) => {
    try {
      await api.delete(`/api/reports/${reportId}`);
      showToast('민원이 삭제되었습니다.', 'success');
      fetchMyReports();
    } catch (error) {
      const serverError = error.response?.data;
      showToast(serverError?.detail || serverError?.error || '민원 삭제에 실패했습니다.', 'error');
    }
  };

  if (!isLoggedIn) {
    return (
      <>
        <AuthView
          authView={authView}
          authData={authData}
          setAuthView={setAuthView}
          setAuthData={setAuthData}
          onSubmit={handleAuth}
        />
        <Toast toast={toast} onClose={() => setToast(null)} />
      </>
    );
  }

  if (role === 'admin') {
    return (
      <>
        <AdminDashboard allReports={allReports} onLogout={handleLogout} onUpdateStatus={updateStatus} />
        <Toast toast={toast} onClose={() => setToast(null)} />
      </>
    );
  }

  return (
    <>
      <UserDashboard
        user={user}
        reports={reports}
        loading={loading}
        selectedImages={selectedImages}
        imageStatus={imageStatus}
        imageError={imageError}
        input={input}
        setInput={setInput}
        complaintStep={complaintStep}
        setComplaintStep={setComplaintStep}
        analysisResult={analysisResult}
        complaintInfo={complaintInfo}
        onLogout={handleLogout}
        onImageUpload={handleImageUpload}
        onImageDrop={handleImageFiles}
        onRemoveImage={removeImage}
        onClearImages={clearImages}
        onAnalyzeReport={handleAnalyzeReport}
        onComplaintInfoChange={updateComplaintInfo}
        onSaveReport={saveToDB}
        onDeleteReport={deleteReport}
        onStartNewReport={handleStartNewReport}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
   );
  }
 
export default ConstructionChatbot;

