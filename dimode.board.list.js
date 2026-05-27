(function ($) {
    $(document).ready(function () {
        // 분류
        $(document).on('change', '#dimodeBoard .list-categories select', function () {
            var locationSearch = dimodeLib.removeParameters(location.search);
            var search = dimodeLib.addArgument(locationSearch, 'category', $(this).val());
            //var search = dimodeLib.addArgument(location.search, 'category', $(this).val()); // 2023-04-19 kk

            if (!dimodeLib.isNullOrEmpty(search))
                //alert("location : " + search);
                location.search = search;
        });


        $(document).on('click', '#dimodeBoard .list-categories .category-btn', function () {
            //페이지+보드 일 때 moduleU가 명확하지 않아 수정 2021-04-09 HSC
            var moduleU = $("#popActionModal input[name='moduleU']").val();
            var search = '/Board/Index/' + moduleU + '?category=' + $(this).data('value');
            location.href = search;
        });

        // 페이징
        $(document).on('click', '#dimodeBoard .board-pages span', function () {
            var searchNum = 1;
            var pageCount = Number($('#dimodeBoard .board-pages').attr('data-page_count'));
            var selectedNumber = Number($('#dimodeBoard .board-pages span.selected').text());
            var pathname = location.pathname;
            var search;

            if ($(this).hasClass('page')) {
                var selectNumber = Number($(this).text());
                searchNum = selectNumber;
            }
            else if ($(this).hasClass('next')) {
                var maxNumber = Number($('#dimodeBoard .board-pages').attr('data-page_max'));
                var nextNumber = selectedNumber + pageCount;
                searchNum = (nextNumber < maxNumber ? nextNumber : maxNumber);
            }
            else if ($(this).hasClass('prev')) {
                var prevNumber = selectedNumber - pageCount;
                searchNum = prevNumber > 1 ? prevNumber : 1;
            }
            // 다음 페이지로 1칸 이동하는 버튼 추가
            else if ($(this).hasClass('next-onepage')) {
                var nextPage = selectedNumber + 1;
                var maxNumber = Number($('#dimodeBoard .board-pages').attr('data-page_max'));
                searchNum = (nextPage <= maxNumber ? nextPage : maxNumber);
            }
            // 이전 페이지로 1칸 이동하는 버튼 추가
            else if ($(this).hasClass('prev-onepage')) {
                var prevPage = selectedNumber - 1;
                searchNum = (prevPage > 1 ? prevPage : 1);
            }

            search = dimodeLib.addArgument(location.search, 'page', searchNum);

            if (pathname && pathname.indexOf('/Detail') >= 0) {
                var arr = pathname.split('/');
                arr.splice(arr.length - 1, 1);
                pathname = arr.join('/').replace('/Detail', '/Index');
                location.href = pathname + search;
            }
            else if (!dimodeLib.isNullOrEmpty(search)) {
                location.search = search;
            }
        });

        // 검색
        $(document).on('submit', '#dimodeBoard .action-search', function (e) {
            e.preventDefault();

            var searchKind = $(this).find('select').val();
            var searchKeyword = $(this).find('input[type=text]').val();
            var search = '';

            if (searchKeyword.trim().length == 0) {
                dimodeLib.bandMessage('warning', '검색어를 입력해주세요.');
                $(this).find('input[type=text]').focus();
                return false;
            }
            else if (searchKeyword.trim().length < 2) {
                dimodeLib.bandMessage('warning', '최소 2자 이상 입력해주세요.');
                $(this).find('input[type=text]').focus();
                return false;
            }

            searchKeyword = encodeURIComponent(searchKeyword);
            search = dimodeLib.addArgument(location.search, 'page', 1);
            search = dimodeLib.addArgument(search, 'searchKind', searchKind);
            search = dimodeLib.addArgument(search, 'searchKeyword', searchKeyword);
            search = encodeURI(search);

            location.search = search;
        });


        /* 게시글 일괄 이동 & 삭제 시작 */
        $(document).on('click', '#dimodeBoard th.document-checkbox input:checkbox', function () {
            $('#dimodeBoard .document-checkbox input:checkbox').prop('checked', $(this).prop('checked'));
        });

        var popAction = '';
        var popActionTitle = '';

        $(document).on('click', '#dimodeBoard .pop-btn', function (e) {

            var thisObj = $(this);
            var checkedBoxes = $('#dimodeBoard .theme-list .document-checkbox input:checkbox:checked');
            var target = new Array();
            var theme = $(this).closest('#dimodeBoard').find('.board-theme');

            popActionTitle = thisObj.text();

            if (checkedBoxes.length < 1) {
                dimodeLib.bandMessage('warning', popActionTitle + '할 게시글을 선택해주세요.');
                return false;
            }

            $('#popActionModal .submit-btn').removeClass('btn-danger').removeClass('btn-info').removeClass('btn-stp');

            if (thisObj.hasClass('delete-btn')) {

                popAction = 'delete';
                $('#popActionModal').attr('action', '/Board/DocumentsActions/Delete');
                $('#popActionModal .modal-footer .board-list').addClass('hide');
                $('#popActionModal .submit-btn').addClass('btn-danger');
                $(".printList").hide();
            }
            else if (thisObj.hasClass('print-btn')) {
                popAction = 'print';
                $('#popActionModal').attr('action', '/Board/DocumentsActions/Print');
                $('#popActionModal .modal-footer .board-list').addClass('hide');
                $('#popActionModal .submit-btn').addClass('btn-danger');
                $(".printList").show();
            }
            else {
                $(".printList").hide();
                if (thisObj.hasClass('move-btn')) {
                    popAction = 'move';
                    $('#popActionModal').attr('action', '/Board/DocumentsActions/Move');
                    $('#popActionModal .submit-btn').addClass('btn-stp');
                }
                else if (thisObj.hasClass('copy-btn')) {
                    popAction = 'copy';
                    $('#popActionModal').attr('action', '/Board/DocumentsActions/Copy');
                    $('#popActionModal .submit-btn').addClass('btn-info');
                }
                else {
                    dimodeLib.bandMessage('danger', '오류가 있습니다.', 0);
                    return false;
                }

                $('#popActionModal .modal-footer .board-list').removeClass('hide');

                var moduleU = $('#popActionModal input[name=moduleU]').val();
                var boardsSelect = $('#popActionModal .modal-footer .board-list select');
                boardsSelect.find('option:gt(0)').remove();

                $.post('/Board/GetBoards/' + moduleU, function (returnData) {

                    var sortData = [];

                    var boards = JSON.parse(returnData);

                    for (var i in boards) {
                        sortData.push({ ModuleU: boards[i].ModuleU, Title: boards[i].Title });
                    }
                    sortData.sort(function (a, b) {
                        return (a.Title < b.Title) ? -1 : (a.Title > b.Title) ? 1 : 0;
                    });

                    $.each(sortData, function (index, value) {
                        boardsSelect.append('<option value="' + value.ModuleU + '">' + value.Title + '</option>');
                    });

                    //for (var i in boards) {
                    //    boardsSelect.append('<option value="' + boards[i].ModuleU + '">' + boards[i].Title + '</option>');
                    //}
                });
            }

            $('#popActionModal .modal-title').text('게시글 ' + popActionTitle + '하기');
            $('#popActionModal .submit-btn').text(popActionTitle + '하기');
            //$('#popActionModal .modal-table thead').html($('#dimodeBoard .theme-list table thead').html());
            $('#popActionModal .modal-table tbody').html('');

            console.log(theme.hasClass('gallery'));
            if (theme.hasClass('gallery')) {
                $('#popActionModal .modal-table thead').html("<tr><td>번호</td><td>제목</td><td>작성자</td><td>날짜</td></tr>");
                var index = 0;
                var documentU = 0;
                checkedBoxes.each(function () {
                    var each = $(this).closest('.each-document');
                    index = index + 1;
                    var title = each.find('.title').text();
                    var writer = each.find('.list-item.writer').text();
                    var regdate = each.find('.list-item.regdate').text();
                    documentU = each.find('input[type=checkbox]').attr('data-u');
                    $('#popActionModal .modal-table tbody').append("<tr><td>" + index + "</td><td>" + title + "</td><td>" + writer + "</td><td>" + regdate + "</td></tr>");
                    target.push($(this).attr('data-u'));
                });
            }
			else if (theme.hasClass('webzine')) {
                    $('#popActionModal .modal-table thead').html("<tr><td>번호</td><td>제목</td><td>작성자</td><td>날짜</td></tr>");
                    index = 0;
                    documentU = 0;
                    checkedBoxes.each(function () {
                        var each = $(this).closest('.each-document');
                        index = index + 1;
                        var title = each.find('.title').text();
                        var writer = each.find('input[type=checkbox]').attr('data-writer');
                        var regdate = each.find('input[type=checkbox]').attr('data-regdate');
                        documentU = each.find('input[type=checkbox]').attr('data-u');
                        $('#popActionModal .modal-table tbody').append("<tr><td>" + index + "</td><td>" + title + "</td><td>" + writer + "</td><td>" + regdate + "</td></tr>");
                        target.push($(this).attr('data-u'));
                    });
            }
            else {
                checkedBoxes.each(function () {
                    var tr = $(this).closest('tr').clone();
                    $('#popActionModal .modal-table tbody').append(tr);
                    if ($(this).attr('data-u') !== undefined) {
                        target.push($(this).attr('data-u'));
                    }
                });
            }

            target.sort();

            $('#popActionModal .modal-table .document-checkbox').remove();
            $('#popActionModal input[name=documentU]').val(target.join(','));
            $('#popActionModal').modal('show');
        });

        $(".printList").click(function () {
            var listHtml = $(".modal-body").html();
            $("#printData").html("");
            $("#printData").append("<div class='page-divide'>" + listHtml + "</div>");

            $("#printData").printThis({
                loadCSS: "/Modules/Board/Content/dimode.board.print.list.css"
            });
        });

        $('#popActionModal').ajaxForm({
            beforeSubmit: function () {
                dimodeLib.bandMessage('warning', '처리 중입니다.', 0);

                if (popAction == 'move') {
                    var moduleU = $('#popActionModal input[name=moduleU]').val();
                    var targetModuleU = $('#popActionModal select[name=targetModuleU] option:selected').val();

                    if (moduleU == targetModuleU) {
                        dimodeLib.bandMessage('warning', '같은 게시판으로 이동할 수 없습니다.');
                        return false;
                    }

                    return dimodeLib.isValidated('#popActionModal');
                }
            },
            success: function (returnData) {
                if (returnData == 'success') {
                    dimodeLib.bandMessageCookie('success', popActionTitle + '하였습니다.');

                    //마지막 페이지에서 이동, 삭제 시 오류 발생하여 수정
                    if (popAction == 'delete' || popAction == 'move') {
                        var loc = location.href;
                        loc = loc.replace("page=", "");
                        location.href = loc;
                        //console.log("location : " + loc);
                    } else {
                        location.reload();
                    }
                }
                else if (returnData) {
                    dimodeLib.bandMessage('success', '데이터를 불러왔습니다.');

                    var documents = $.parseJSON(returnData);

                    $("#printData").html('');

                    $.each(documents, function (i, doc) {
                        var d = doc.DocumentWithCategory.RegDate.toString().substr(0, 4) + "-" + doc.DocumentWithCategory.RegDate.toString().substr(4, 2) + "-" + doc.DocumentWithCategory.RegDate.toString().substr(6, 2) + " " + doc.DocumentWithCategory.RegDate.toString().substr(8, 2) + ":" + doc.DocumentWithCategory.RegDate.toString().substr(10, 2) + ":" + doc.DocumentWithCategory.RegDate.toString().substr(12, 2);
                        var detail_top = '<div class="detail-top"><div class="document-title"><span class="category">[' + doc.DocumentWithCategory.Category + ']</span> ' + doc.DocumentWithCategory.Title + '</div><div class="document-regdate">' + d + '</div></div>';

                        var document_extended_keys = '<div class="document-extended_keys"><table class="table"><tbody><tr>';
                        $.each(doc.DocumentExtendValues, function (j, ext) {
                            document_extended_keys += '<tr><th data-keyname="' + ext.Name + '" class="col-sm-2 col-xs-4 text-right">' + ext.Title + '</th><td data-keyname="' + ext.Name + '" class="col-sm-10 col-xs-8">' + ext.Value.replace(/(\n|\r\n)/g, '<br>') + '</td></tr>';
                        });
                        document_extended_keys += '</tbody></table></div>';

                        var detail_content = '<div class="detail-content">' + doc.DocumentWithCategory.Content + '</div>';

                        var doc_html = detail_top + document_extended_keys + detail_content;
                        $("#printData").append("<div class='page-divide'>" + doc_html + "</div>");
                    });

                    $("#printData").printThis({
                        loadCSS: "/Modules/Board/Content/dimode.board.print.css"
                    });

                }
                else {
                    dimodeLib.bandMessage('danger', '오류가 있습니다.#1', 0);
                }
            },
            error: function () {
                dimodeLib.bandMessage('danger', '오류가 있습니다.#2', 0);
            }
        });
        /* 게시글 일괄 이동 & 삭제 끝 */
    });
})(jQuery);