(function ($) {
    $(document).ready(function () {
    	
    	$(window).load(function(){
    	  
        });
        // 내용에 있는 이미지 클릭 시 확대
        $(document).on('click', '.detail-content img', function () {
        		var parent = $(this).parent('a');
        		
        		if(parent.attr("href") === undefined)
        		{
	            if ($('#imgArea').length < 1)
	                $('body').append('<div id="imgArea"></div>');
	
	            $('#imgArea').removeClass('hide');
	            $('#imgArea').html($(this).clone());
	
	            var pop = {
	                width: $('#imgArea > img').width() + 12,
	                height: $('#imgArea > img').height() + 12
	            }
	
	            if (pop.width < 100) {
	                pop.width = $(document).width();
	                pop.height = $(document).height();
	            }
	
	            if (pop.width == 0 || pop.height == 0) {
	                pop.width = $(document).width();
	                pop.height = $(document).height();
	            }
	
	            $('#imgArea').addClass('hide');
	
	            var src = $(this).attr('src');
	            //if (window._cordovaNative)
	            //    src = "http://image.dimode.co.kr" + $(this).attr('src');
	            //else
	                src = "/Board/Viewer?path=" + $(this).attr('src');
	
	            dimodeLib.openPop(src, '_blank', 'width=' + pop.width + ', height=' + pop.height + ', scrollbars=yes, resizable=yes');
	          }
        });

        if (window._cordovaNative) {
            document.addEventListener("pause", onPause, false);

            function onPause() {
                window.location.reload(true);
            }
        }
    });
})(jQuery);