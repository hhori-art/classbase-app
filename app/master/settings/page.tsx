'use client';



import { useState, useEffect } from 'react';

import { db } from '@/lib/firebase';

import { collection, getDocs, doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';

import { ArrowLeft, SlidersHorizontal, Link as LinkIcon, Loader2, Save } from 'lucide-react';

import Link from 'next/link';



// ウィークセレクター(別ファイルの場合はimport、なければここに簡易実装も可)

// 今回は簡易実装を埋め込みます

const SimpleWeekSelector = () => {

const [currentWeek, setCurrentWeek] = useState('1');

const [loading, setLoading] = useState(false);



useEffect(() => {

getDoc(doc(db, 'settings', 'global')).then(snap => {

if (snap.exists()) setCurrentWeek(snap.data().current_week || '1');

});

}, []);



const saveWeek = async () => {

setLoading(true);

await setDoc(doc(db, 'settings', 'global'), { currentWeek }, { merge: true });

alert('現在の週を更新しました');

setLoading(false);

};



return (

<div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 mb-8">

<h2 className="text-sm font-bold text-gray-500 mb-2">現在の週設定</h2>

<div className="flex gap-4 items-center">

<select

className="p-2 border rounded-lg font-bold text-lg"

value={currentWeek}

onChange={e => setCurrentWeek(e.target.value)}

>

{Array.from({length: 40}, (_, i) => i + 1).map(w => (

<option key={w} value={String(w)}>第 {w} 週</option>

))}

</select>

<button onClick={saveWeek} disabled={loading} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 disabled:opacity-50">

{loading ? '保存中...' : '更新'}

</button>

</div>

</div>

);

};



const SOCIAL_SUBJECTS = ['歴史', '地理', '公民'];

const SCIENCE_SUBJECTS = ['生物', '化学', '物理', '地学'];

const DAYS = ['月', '火', '水', '木', '金', '土'];



export default function SettingsPage() {

const [urls, setUrls] = useState<{[key: string]: string}>({});

const [loading, setLoading] = useState(true);

const [saving, setSaving] = useState(false);



useEffect(() => {

const fetchUrls = async () => {

try {

const snap = await getDocs(collection(db, 'subject_urls'));

const urlMap: {[key: string]: string} = {};

snap.forEach(doc => {

urlMap[doc.id] = doc.data().url;

});

setUrls(urlMap);

} catch (e) {

console.error(e);

} finally {

setLoading(false);

}

};

fetchUrls();

}, []);



const handleUrlChange = (subject: string, day: string, value: string) => {

const key = `${subject}_${day}`;

setUrls(prev => ({ ...prev, [key]: value }));

};



// フォーカスが外れたタイミングなどで保存

const saveUrl = async (subject: string, day: string) => {

const key = `${subject}_${day}`;

const url = urls[key];

if (url === undefined) return; // 変更なしならスキップ



// UX: 保存中表示などは省略し、裏で静かに保存

try {

const docRef = doc(db, 'subject_urls', key);

await setDoc(docRef, {

subject,

day_of_week: day,

url,

updated_at: new Date().toISOString()

}, { merge: true });

console.log('Saved:', key);

} catch (e) {

console.error('Save failed:', e);

alert('保存に失敗しました');

}

};



if (loading) return <div className="min-h-screen flex justify-center items-center"><Loader2 className="animate-spin text-gray-400"/></div>;



return (

<div className="min-h-screen bg-gray-100 p-8 pb-40">

<div className="max-w-6xl mx-auto">


<div className="flex items-center gap-4 mb-8">

<Link href="/master" className="bg-white p-2 rounded-full shadow hover:bg-gray-50 text-gray-600">

<ArrowLeft size={24} />

</Link>

<h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">

<SlidersHorizontal className="text-purple-600" /> 設定・マスタ管理

</h1>

</div>



{/* 1. 週設定 */}

<SimpleWeekSelector />



{/* 2. 科目別URL設定 */}

<div className="space-y-8">


{/* 社会科グループ */}

<div className="bg-white p-6 rounded-2xl shadow-sm border-l-4 border-orange-500">

<h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">

<LinkIcon className="text-orange-500" /> 社会科グループ (URL設定)

</h2>

<div className="overflow-x-auto">

<table className="w-full text-sm text-left border-collapse">

<thead>

<tr className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-200">

<th className="px-4 py-3 border-r">科目</th>

{DAYS.map(day => <th key={day} className="px-4 py-3 text-center min-w-[120px]">{day}</th>)}

</tr>

</thead>

<tbody className="divide-y divide-gray-100">

{SOCIAL_SUBJECTS.map(subject => (

<tr key={subject} className="hover:bg-gray-50 transition-colors">

<td className="px-4 py-3 font-bold text-gray-700 bg-gray-50/50 border-r">{subject}</td>

{DAYS.map(day => (

<td key={day} className="px-2 py-2 border-r last:border-r-0">

<input

type="text"

placeholder="Zoom URL..."

className="w-full p-2 border border-gray-200 rounded text-xs focus:ring-2 focus:ring-orange-500 outline-none"

value={urls[`${subject}_${day}`] || ''}

onChange={(e) => handleUrlChange(subject, day, e.target.value)}

onBlur={() => saveUrl(subject, day)}

/>

</td>

))}

</tr>

))}

</tbody>

</table>

</div>

</div>



{/* 理科グループ */}

<div className="bg-white p-6 rounded-2xl shadow-sm border-l-4 border-green-500">

<h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">

<LinkIcon className="text-green-500" /> 理科グループ (URL設定)

</h2>

<div className="overflow-x-auto">

<table className="w-full text-sm text-left border-collapse">

<thead>

<tr className="bg-gray-50 text-gray-500 text-xs uppercase border-b border-gray-200">

<th className="px-4 py-3 border-r">科目</th>

{DAYS.map(day => <th key={day} className="px-4 py-3 text-center min-w-[120px]">{day}</th>)}

</tr>

</thead>

<tbody className="divide-y divide-gray-100">

{SCIENCE_SUBJECTS.map(subject => (

<tr key={subject} className="hover:bg-gray-50 transition-colors">

<td className="px-4 py-3 font-bold text-gray-700 bg-gray-50/50 border-r">{subject}</td>

{DAYS.map(day => (

<td key={day} className="px-2 py-2 border-r last:border-r-0">

<input

type="text"

placeholder="Zoom URL..."

className="w-full p-2 border border-gray-200 rounded text-xs focus:ring-2 focus:ring-green-500 outline-none"

value={urls[`${subject}_${day}`] || ''}

onChange={(e) => handleUrlChange(subject, day, e.target.value)}

onBlur={() => saveUrl(subject, day)}

/>

</td>

))}

</tr>

))}

</tbody>

</table>

</div>

</div>



</div>

</div>

</div>

);

}