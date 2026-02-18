(function () {
    'use strict';

    var Manifest = {
        id: 'ph_rt_plugin',
        version: '2.1.0',
        name: 'PH RT',
        component: 'ph_rt_component',
        source: 'https://rt.pornhub.com',
        proxy: 'https://api.codetabs.com/v1/proxy?quest=' 
    };

    var Lampa = window.Lampa;
    var Network = Lampa.Network;
    var Utils = Lampa.Utils;
    var Storage = Lampa.Storage;

    var Api = {
        get: function (method, success, error) {
            var url = Manifest.source + method;
            var proxy = Storage.get('ph_proxy_url', Manifest.proxy);
            var final = proxy + encodeURIComponent(url);
            
            Network.silent(final, function(str) {
                success(str);
            }, error);
        },

        list: function (html) {
            var items = [];
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var elements = doc.querySelectorAll('li.js-pop.videoblock');
            
            if(!elements.length) elements = doc.querySelectorAll('.videoblock');

            elements.forEach(function (el) {
                var link_el = el.querySelector('a[href*="viewkey"]');
                var img_el = el.querySelector('img');
                var title_el = el.querySelector('.title a');
                var dur_el = el.querySelector('.duration');
                
                if (link_el && img_el && title_el) {
                    var link = link_el.getAttribute('href');
                    var title = title_el.getAttribute('title') || title_el.innerText;
                    var img = img_el.getAttribute('data-mediumthumb') || img_el.getAttribute('data-src') || img_el.src;
                    var duration = dur_el ? dur_el.innerText : '';
                    
                    items.push({
                        type: 'video',
                        title: title,
                        url: link,
                        img: img,
                        duration: duration
                    });
                }
            });
            
            var next = doc.querySelector('.pagination_next a');
            var next_page = next ? next.getAttribute('href') : false;

            return { results: items, page: next_page };
        },

        extract: function (html) {
            var match = html.match(/flashvars_\d+\s*=\s*({.+?});/);
            var result = {};

            if (match) {
                try {
                    var json = JSON.parse(match[1]);
                    result = {
                        title: json.video_title,
                        img: json.image_url,
                        videos: []
                    };

                    if (json.mediaDefinitions) {
                        json.mediaDefinitions.forEach(function (v) {
                            if (v.format === 'mp4' && v.videoUrl) {
                                var q = Array.isArray(v.quality) ? v.quality[0] : v.quality;
                                result.videos.push({
                                    title: q + 'p',
                                    quality: parseInt(q),
                                    url: v.videoUrl
                                });
                            }
                        });
                    }
                    result.videos.sort(function(a,b){ return b.quality - a.quality });
                } catch (e) {}
            }
            return result;
        }
    };

    function Component(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function () {
            this.activity.loader(true);
            return this.render();
        };

        comp.start = function () {
            this.build();
        };

        comp.build = function () {
            var _this = this;
            this.activity.head = Lampa.Template.get('head', { title: 'PH RT' });
            
            this.activity.head.querySelector('.open--search').addEventListener('click', function () {
                Lampa.Input.edit({
                    title: 'Поиск',
                    value: '',
                    free: true,
                    nosave: true
                }, function (new_value) {
                    _this.activity.line.find('.card').remove();
                    _this.activity.loader(true);
                    _this.load('/video/search?search=' + encodeURIComponent(new_value));
                });
            });

            this.activity.line = Lampa.Template.get('items_line', { title: 'Главная' });
            this.activity.render().find('.activity__body').append(this.activity.head);
            this.activity.render().find('.activity__body').append(this.activity.line);
            
            this.load('/');
        };

        comp.load = function (endpoint) {
            var _this = this;
            
            Api.get(endpoint, function(html) {
                var data = Api.list(html);
                _this.append(data);
                _this.activity.loader(false);
            }, function() {
                _this.activity.loader(false);
                Lampa.Noty.show('Ошибка сети');
                _this.activity.empty();
            });
        };

        comp.append = function (data) {
            var _this = this;
            
            if(!data.results.length) {
                Lampa.Noty.show('Пусто');
                return;
            }

            data.results.forEach(function (element) {
                var card = Lampa.Template.get('card', {
                    title: element.title,
                    release_year: element.duration
                });
                
                card.addClass('card--video');
                var img = card.find('.card__img')[0];
                img.onload = function () { card.addClass('card--loaded'); };
                img.onerror = function () { img.src = './img/img_broken.svg'; };
                img.src = element.img;

                card.on('hover:enter', function () {
                    Lampa.Activity.push({
                        url: element.url,
                        title: element.title,
                        component: 'ph_rt_view',
                        page: 1
                    });
                });
                
                _this.activity.line.append(card);
            });

            if (data.page) {
                var more = Lampa.Template.get('more');
                more.on('hover:enter', function () {
                    _this.activity.line.find('.selector').remove();
                    _this.load(data.page);
                });
                this.activity.line.append(more);
            }
            
            this.activity.toggle();
        };

        return comp;
    }

    function View(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function () {
            this.activity.loader(true);
            return this.render();
        };

        comp.start = function () {
            var _this = this;
            Api.get(object.url, function(html){
                var data = Api.extract(html);
                if(data.videos && data.videos.length){
                    _this.show(data);
                } else {
                    Lampa.Noty.show('Видео не найдено');
                    _this.activity.empty();
                }
            }, function(){
                _this.activity.empty();
            });
        };
        
        comp.show = function(data) {
            var _this = this;
            var desc = Lampa.Template.get('description', {
                title: data.title,
                descr: ''
            });
            
            Lampa.Activity.active().activity.render().find('.background').attr('src', data.img);

            var btn = Lampa.Template.get('button', { title: 'Смотреть' });
            btn.on('hover:enter', function(){
                Lampa.Select.show({
                    title: 'Качество',
                    items: data.videos,
                    onSelect: function(v){
                        var vid = {
                            title: data.title,
                            url: v.url,
                            timeline: { hash: Lampa.Utils.uid(data.title) }
                        };
                        Lampa.Player.play(vid);
                        Lampa.Player.playlist([vid]);
                    }
                });
            });
            
            this.activity.render().find('.activity__body').append(desc);
            this.activity.render().find('.activity__body').append(btn);
            this.activity.loader(false);
            this.activity.toggle();
        };

        return comp;
    }

    if (!window.ph_rt_loaded) {
        window.ph_rt_loaded = true;
        
        Lampa.Component.add('ph_rt_component', Component);
        Lampa.Component.add('ph_rt_view', View);

        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') {
                var ico = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>';
                var item = Lampa.Template.get('activity_menu_item', {
                    title: 'PH RT',
                    icon: ico
                });
                item.on('hover:enter', function () {
                    Lampa.Activity.push({
                        url: '',
                        title: 'PH RT',
                        component: 'ph_rt_component',
                        page: 1
                    });
                });
                $('.activity__menu .activity__menu-list').append(item);
            }
        });
        
        Lampa.Settings.listener.follow('open', function (e) {
            if(e.name == 'main') {
                var item = Lampa.Template.get('settings_param', {
                    name: 'PH Proxy URL',
                    value: Storage.get('ph_proxy_url', Manifest.proxy),
                    descr: ''
                });
                item.on('hover:enter', function(){
                    Lampa.Input.edit({
                        title: 'Proxy',
                        value: Storage.get('ph_proxy_url', Manifest.proxy),
                        free: true
                    }, function(val){
                        Storage.set('ph_proxy_url', val);
                        item.find('.settings-param__value').text(val);
                    });
                });
                e.body.find('.settings-param__body').append(item);
            }
        });
    }
})();
