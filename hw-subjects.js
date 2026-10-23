/* =============================================================================
   hw-subjects.js — danh sách các môn theo thời khoá biểu + màu pastel từng môn
   -----------------------------------------------------------------------------
   Mỗi môn 1 màu pastel riêng, chữ trắng trong ô bo tròn.
   Tên môn được LƯU nguyên văn vào cơ sở dữ liệu (cột content_table), nên đừng
   đổi tên ở đây sau khi đã đăng bài, kẻo bài cũ mất màu.
   ============================================================================= */
(function(){
  var LIST = [
    { name:'Chào Cờ',                 color:'#F07A8C' },
    { name:'Toán Học',                color:'#6BA6F2' },
    { name:'Ngữ Văn',                 color:'#E98FC4' },
    { name:'Tiếng Anh',               color:'#5FC4A5' },
    { name:'KHTN (Vật Lý)',           color:'#8A94EC' },
    { name:'KHTN (Hoá Học)',          color:'#B68CE6' },
    { name:'KHTN (Sinh Học)',         color:'#86C965' },
    { name:'Lịch Sử',                 color:'#D9A25F' },
    { name:'Địa Lý',                  color:'#4FBCC8' },
    { name:'Giáo dục công dân',       color:'#E58A6B' },
    { name:'Công Nghệ',               color:'#8FA3B5' },
    { name:'Tin Học',                 color:'#5CB3EA' },
    { name:'Âm Nhạc',                 color:'#CF8EDB' },
    { name:'Mỹ Thuật',                color:'#EDB142' },
    { name:'HĐTN',                    color:'#A6C94F' },
    { name:'Giáo dục thể chất',       color:'#F5945A' },
    { name:'Giáo dục địa phương',     color:'#B0937A' }
  ];
  var FALLBACK = '#A9A6BD';
  var byName = {};
  LIST.forEach(function(s){ byName[s.name] = s.color; });

  window.HW_SUBJECTS = LIST;
  window.hwSubjectColor = function(name){ return byName[name] || FALLBACK; };
})();
