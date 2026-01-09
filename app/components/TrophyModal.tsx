'use client';

import { RANKS, BADGES, getRank } from '@/lib/gamification';
import { X, Lock, Star } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  points: number;
  earnedBadges: string[];
}

export default function TrophyModal({ isOpen, onClose, points, earnedBadges = [] }: Props) {
  if (!isOpen) return null;

  const currentRank = getRank(points);
  const nextRank = RANKS.find(r => r.min > points);
  
  const prevRankMin = currentRank.min;
  const nextRankMin = nextRank ? nextRank.min : points * 1.5;
  const progress = Math.min(100, Math.max(0, ((points - prevRankMin) / (nextRankMin - prevRankMin)) * 100));

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      {/* オーバーレイをクリックしても閉じたい場合はここに onClick={onClose} を追加できます */}
      
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 relative">
        
        {/* ヘッダー: ランク表示 */}
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-6 text-center text-white relative">
          
          {/* ▼▼▼ 修正箇所：判定を広げるクラスを追加しました ▼▼▼ */}
          <button 
            onClick={onClose} 
            className="absolute top-4 right-4 bg-white/20 p-1 rounded-full hover:bg-white/40 transition-colors after:absolute after:-inset-4 after:content-['']"
            aria-label="閉じる"
          >
            <X size={20} />
          </button>
          {/* ▲▲▲ 修正箇所終わり ▲▲▲ */}
          
          <div className="text-6xl mb-2 filter drop-shadow-lg">{currentRank.icon}</div>
          <h2 className="text-2xl font-extrabold tracking-wider">{currentRank.name}</h2>
          <div className="mt-4 bg-black/20 rounded-full h-4 w-full max-w-[200px] mx-auto relative overflow-hidden">
            <div 
              className="absolute top-0 left-0 h-full bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.5)] transition-all duration-1000"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <p className="text-xs font-bold mt-2 opacity-90">
            現在のスコア: <span className="text-xl">{points}</span> pt
            {nextRank && <span className="ml-2"> (あと {nextRank.min - points} pt)</span>}
          </p>
        </div>

        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {/* ミッション（簡易表示） */}
          <div className="mb-6">
            <h3 className="text-sm font-extrabold text-gray-700 mb-3 flex items-center gap-2">
              <Star className="text-orange-500" size={18} /> 次のミッション
            </h3>
            <div className="space-y-2">
              <div className="bg-orange-50 p-3 rounded-xl border border-orange-100 flex justify-between items-center">
                <span className="text-xs font-bold text-gray-700">宿題を提出しよう</span>
                <span className="text-xs font-bold text-orange-600 bg-white px-2 py-1 rounded-md border border-orange-200">+100pt</span>
              </div>
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 flex justify-between items-center">
                <span className="text-xs font-bold text-gray-700">Zoom授業に参加しよう</span>
                <span className="text-xs font-bold text-blue-600 bg-white px-2 py-1 rounded-md border border-blue-200">+50pt</span>
              </div>
            </div>
          </div>

          {/* バッジ一覧 */}
          <div>
            <h3 className="text-sm font-extrabold text-gray-700 mb-3">コレクションバッジ</h3>
            <div className="grid grid-cols-3 gap-3">
              {BADGES.map((badge) => {
                const isUnlocked = earnedBadges.includes(badge.id);
                return (
                  <div key={badge.id} className={`aspect-square rounded-2xl flex flex-col items-center justify-center p-2 text-center border-2 transition-all ${
                    isUnlocked 
                      ? 'bg-yellow-50 border-yellow-200 shadow-sm' 
                      : 'bg-gray-50 border-gray-100 opacity-60 grayscale'
                  }`}>
                    <div className="text-3xl mb-1">{isUnlocked ? badge.icon : <Lock size={24} className="text-gray-300"/>}</div>
                    <div className="text-[10px] font-bold text-gray-600 leading-tight">{badge.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}